// Prompt transition state machine. A prompt change crossfades over a few sends
// so generation eases between mixtures instead of jumping. The machine is pure
// and transport-neutral: it drives a host-supplied clock and a `PromptSender`,
// and the SDK transport stage wires that sender to a live Lyria session. Timing
// is expressed in musical/wall-clock milliseconds by configuration but scheduled
// against the clock's absolute-seconds contract.

import type { ClockTimer, MonotonicClock } from '@luna-estelar/gas-protocol';
import { ConnectorError } from '@luna-estelar/gas-protocol';
import type { WeightedPrompt } from './prompts.js';

export interface PromptSender {
  send(prompts: readonly WeightedPrompt[]): Promise<void>;
  requestPlay(): Promise<void>;
  requestPause(): Promise<void>;
}

export type PromptTransitionOptions = {
  readonly clock: MonotonicClock;
  readonly sender: PromptSender;
  readonly onFailure: (failure: ConnectorError) => void;
  readonly transitionDurationMs: number;
  readonly transitionSteps: number;
};

export interface PromptTransition {
  /** Start a run; clears the last emitted mixture and the per-run failure flag. */
  beginRun(runId: string): void;
  /** End a run; cancels pending sends and clears the last emitted mixture. */
  endRun(runId: string): void;
  /** Crossfade toward a target; resolves once the first send is dispatched. */
  update(target: readonly WeightedPrompt[]): Promise<void>;
  /** The last mixture handed to the sender. */
  lastEmitted(): readonly WeightedPrompt[];
}

interface TransitionStep {
  readonly atMs: number;
  readonly progress: number;
}

function planSteps(durationMs: number, steps: number): readonly TransitionStep[] {
  if (steps <= 1 || durationMs <= 0) {
    return [{ atMs: 0, progress: 1 }];
  }
  const plan: TransitionStep[] = [];
  for (let index = 0; index < steps; index++) {
    plan.push({ atMs: (index * durationMs) / (steps - 1), progress: (index + 1) / steps });
  }
  return plan;
}

/** Linear mixture between two prompt maps at a given progress; drops zero weights. */
function mixAt(
  from: readonly WeightedPrompt[],
  to: readonly WeightedPrompt[],
  progress: number
): WeightedPrompt[] {
  const fromWeights = new Map(from.map((prompt) => [prompt.text, prompt.weight]));
  const toWeights = new Map(to.map((prompt) => [prompt.text, prompt.weight]));

  const order: string[] = [];
  const seen = new Set<string>();
  for (const prompt of [...from, ...to]) {
    if (!seen.has(prompt.text)) {
      seen.add(prompt.text);
      order.push(prompt.text);
    }
  }

  const result: WeightedPrompt[] = [];
  for (const text of order) {
    const start = fromWeights.get(text) ?? 0;
    const end = toWeights.get(text) ?? 0;
    const weight = start + (end - start) * progress;
    if (weight !== 0) result.push({ text, weight });
  }
  return result;
}

function promptsEqual(a: readonly WeightedPrompt[], b: readonly WeightedPrompt[]): boolean {
  if (a.length !== b.length) return false;
  const weights = new Map(a.map((prompt) => [prompt.text, prompt.weight]));
  return b.every((prompt) => weights.get(prompt.text) === prompt.weight);
}

function toConnectorError(error: unknown): ConnectorError {
  if (ConnectorError.isConnectorError(error)) return error;
  return new ConnectorError({
    code: 'lyria-prompt-send-failed',
    reason: 'internal',
    retryable: false
  });
}

export function createPromptTransition(options: PromptTransitionOptions): PromptTransition {
  const { clock, sender, onFailure, transitionDurationMs, transitionSteps } = options;

  let runId: string | undefined;
  let generation = 0;
  let failureReported = false;
  let lastEmittedPrompts: readonly WeightedPrompt[] = [];
  let timers: ClockTimer[] = [];
  let chain: Promise<void> = Promise.resolve();

  function cancelTimers(): void {
    for (const timer of timers) clock.cancel(timer);
    timers = [];
  }

  // Serialize every send through one chain so wire order holds even when the
  // sender is slow. The returned promise carries the outcome to the caller; the
  // chain tail always resolves so a rejection never stalls later sends.
  function enqueue(action: () => Promise<void>): Promise<void> {
    const run = chain.then(action);
    chain = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  function reportFailure(error: unknown, transitionGeneration: number): void {
    if (transitionGeneration !== generation) return;
    if (failureReported) return;
    failureReported = true;
    cancelTimers();
    onFailure(toConnectorError(error));
  }

  return {
    beginRun(nextRunId: string): void {
      if (runId !== undefined) {
        throw new ConnectorError({
          code: 'lyria-transition-run-active',
          reason: 'internal',
          retryable: false
        });
      }
      cancelTimers();
      runId = nextRunId;
      generation++;
      failureReported = false;
      lastEmittedPrompts = [];
      chain = Promise.resolve();
    },

    endRun(endingRunId: string): void {
      if (runId !== endingRunId) return;
      cancelTimers();
      generation++;
      runId = undefined;
      lastEmittedPrompts = [];
    },

    async update(target: readonly WeightedPrompt[]): Promise<void> {
      if (runId === undefined) {
        throw new ConnectorError({
          code: 'lyria-transition-no-run',
          reason: 'internal',
          retryable: false
        });
      }

      const from = lastEmittedPrompts;
      const to = target;

      // Unchanged target with nothing in flight: no work.
      if (timers.length === 0 && promptsEqual(from, to)) {
        return;
      }

      cancelTimers();
      const transitionGeneration = ++generation;
      const wasEmpty = from.length === 0;
      const willBeEmpty = to.length === 0;
      const plan = planSteps(transitionDurationMs, transitionSteps);
      const t0 = clock.now();

      const runStep = async (index: number): Promise<void> => {
        if (transitionGeneration !== generation) return;
        const mix = mixAt(from, to, plan[index].progress);
        lastEmittedPrompts = mix;
        await sender.send(mix);
        if (index === plan.length - 1 && willBeEmpty) {
          await sender.requestPause();
        }
      };

      // The first send (and the play request when starting from empty) is
      // awaited. A failure here rejects update() with a sanitized error and
      // schedules nothing; the caller's Connector.update path reports it, so
      // onFailure is not called and there is no double report.
      try {
        await enqueue(() => runStep(0));
        if (wasEmpty && !willBeEmpty) {
          await enqueue(() => sender.requestPlay());
        }
      } catch (error) {
        throw toConnectorError(error);
      }

      // Later sends run on the clock without holding the caller. Deadlines are
      // absolute from t0 so a slow first send does not accumulate drift. Each
      // timer drops itself from the pending set when it fires, so `timers`
      // always reflects work still in flight.
      for (let index = 1; index < plan.length; index++) {
        const deadline = t0 + plan[index].atMs / 1000;
        let timer: ClockTimer;
        const fire = (): void => {
          timers = timers.filter((pending) => pending !== timer);
          if (transitionGeneration !== generation) return;
          void enqueue(() => runStep(index)).catch((error) =>
            reportFailure(error, transitionGeneration)
          );
        };
        timer = clock.schedule(deadline, fire);
        timers.push(timer);
      }
    },

    lastEmitted(): readonly WeightedPrompt[] {
      return lastEmittedPrompts;
    }
  };
}
