// One Magenta RT2 connection: one Play. Turns GAS state into style prompts and
// decides when the bridge generates. The bridge's session starts at the first
// prompts to play; until then keepalives hold the socket open through a rest.

import type {
  ClockTimer,
  Connection,
  ConnectorError,
  ConnectorTiming,
  ConnectorUpdate,
  ConnectorWarning,
  EffectiveState,
  MonotonicClock,
  MusicalPosition
} from '@luna-estelar/gas/protocol';
import type { MagentaRt2ConnectorConfig } from './config.js';
import { connectorError, hostCall, raceAbort } from './errors.js';
import { MAX_PROMPT_BYTES, MAX_PROMPTS, translatePrompts, type WeightedPrompt } from './prompts.js';
import type { MagentaRt2Session } from './transport.js';

/**
 * Turns an effective state into at most six weighted prompts. Pure and
 * synchronous. An empty list means nothing plays, and generation pauses.
 */
export type MagentaRt2Translate = (
  state: EffectiveState,
  config: MagentaRt2ConnectorConfig,
  timing: ConnectorTiming
) => readonly WeightedPrompt[];

export type MagentaRt2WarningCode =
  'magenta-rt2-prompt-overflow' | 'magenta-rt2-prompt-truncated' | 'magenta-rt2-no-keepalive';

export const MAGENTA_RT2_WARNING_MESSAGE =
  'The Magenta RT2 connector reported an operational warning.';

/**
 * A third of the bridge's 30 s idle timeout, so one lost keepalive doesn't
 * close the socket.
 */
export const KEEPALIVE_SECONDS = 10;

export interface MagentaRt2ConnectionOptions {
  readonly session: MagentaRt2Session;
  readonly config: MagentaRt2ConnectorConfig;
  readonly timing: ConnectorTiming;
  readonly clock: MonotonicClock;
  /** A replacement translation. Without one, `translatePrompts` runs and warns. */
  readonly translate?: MagentaRt2Translate;
  onWarning(warning: ConnectorWarning): void;
  onError(error: ConnectorError): void;
}

const encoder = new TextEncoder();

function translateFailed(): ConnectorError {
  return connectorError('magenta-rt2-translate-failed', 'internal', false);
}

/** What the bridge accepts (PROTOCOL.md): 1-512 bytes of text and a finite weight of at least 0. */
function isWeightedPrompt(value: unknown): value is WeightedPrompt {
  if (value === null || typeof value !== 'object') return false;
  const { text, weight } = value as Record<string, unknown>;
  if (typeof text !== 'string' || typeof weight !== 'number') return false;
  const bytes = encoder.encode(text).byteLength;
  return bytes > 0 && bytes <= MAX_PROMPT_BYTES && Number.isFinite(weight) && weight >= 0;
}

function samePrompts(a: readonly WeightedPrompt[], b: readonly WeightedPrompt[]): boolean {
  return (
    a.length === b.length &&
    a.every((prompt, index) => prompt.text === b[index]!.text && prompt.weight === b[index]!.weight)
  );
}

export class MagentaRt2Connection implements Connection {
  /** The prompts GAS last asked for. */
  private prompts: readonly WeightedPrompt[] = [];
  /** What the bridge was last told to play. Kept while paused, so a return needs no resend. */
  private bridgePrompts: readonly WeightedPrompt[] = [];
  /** The bridge has been sent `start`. Its session stays started, paused or not. */
  private started = false;
  private bridgePaused = false;
  private paused = false;
  private starting = true;
  private ended = false;
  private readonly warned = new Set<MagentaRt2WarningCode>();
  private keepaliveTimer: ClockTimer | undefined;
  /** Commands run one at a time, so a pause can't overtake the style it follows. */
  private queue: Promise<void> = Promise.resolve();
  /** Rejects with a failure during startup, so `start()` stops waiting. */
  private readonly startupFailure: Promise<never>;
  private failStartup: (error: ConnectorError) => void = () => undefined;

  constructor(private readonly options: MagentaRt2ConnectionOptions) {
    this.startupFailure = new Promise<never>((_, reject) => {
      this.failStartup = reject;
    });
    this.startupFailure.catch(() => undefined);
    if (options.session.controls.includes('keepalive')) this.scheduleKeepalive();
    else this.warn('magenta-rt2-no-keepalive');
  }

  /**
   * Sends the first prompts. Empty prompts start nothing, so a piece that opens
   * with a rest connects and stays quiet.
   */
  async start(state: EffectiveState, signal: AbortSignal): Promise<void> {
    await raceAbort(signal, Promise.race([this.apply(state), this.startupFailure]));
    this.starting = false;
  }

  async update(update: ConnectorUpdate, requested: MusicalPosition): Promise<MusicalPosition> {
    if (this.ended) throw connectorError('magenta-rt2-connection-closed', 'internal', false);
    await this.apply(update.state);
    return requested;
  }

  async pause(): Promise<void> {
    this.paused = true;
    await this.sync();
  }

  async resume(): Promise<void> {
    this.paused = false;
    await this.sync();
  }

  close(): Promise<void> {
    this.ended = true;
    this.stopKeepalive();
    return this.options.session.close();
  }

  /**
   * Ends the connection after a failure. Reported once, through `onError` after
   * startup, or as the startup's rejection before it.
   */
  fail(error: ConnectorError): void {
    if (this.ended) return;
    this.ended = true;
    this.stopKeepalive();
    void this.options.session.close();
    if (this.starting) this.failStartup(error);
    else hostCall(() => this.options.onError(error));
  }

  private apply(state: EffectiveState): Promise<void> {
    this.prompts = this.translate(state);
    return this.sync();
  }

  private translate(state: EffectiveState): readonly WeightedPrompt[] {
    const { translate, config, timing } = this.options;
    if (translate === undefined) {
      const translation = translatePrompts(timing, state, config.prompt);
      if (translation.overflowed) this.warn('magenta-rt2-prompt-overflow');
      if (translation.truncated) this.warn('magenta-rt2-prompt-truncated');
      return translation.prompts;
    }
    let prompts: unknown;
    try {
      prompts = translate(state, config, timing);
    } catch {
      throw translateFailed();
    }
    if (
      !Array.isArray(prompts) ||
      prompts.length > MAX_PROMPTS ||
      !prompts.every(isWeightedPrompt) ||
      (prompts.length > 0 && !prompts.some((prompt) => prompt.weight > 0))
    ) {
      throw translateFailed();
    }
    return prompts;
  }

  private sync(): Promise<void> {
    const run = this.queue.then(() => this.reconcile());
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Generates only with prompts to play and no pause from GAS (rule 6). */
  private async reconcile(): Promise<void> {
    if (this.ended) return;
    const { session, config } = this.options;
    const wanted = this.prompts;
    const play = wanted.length > 0 && !this.paused;
    if (!this.started) {
      if (!play) return;
      await session.start(wanted, config.generation);
      this.started = true;
      this.bridgePrompts = wanted;
      this.stopKeepalive();
      return;
    }
    if (wanted.length > 0 && !samePrompts(wanted, this.bridgePrompts)) {
      await session.style(wanted);
      this.bridgePrompts = wanted;
    }
    if (this.bridgePaused === play) {
      await session.pause(!play);
      this.bridgePaused = !play;
    }
  }

  // The bridge closes a greeted socket with 4408 after 30 s without a message
  // while nothing is started. A paused session counts as started.
  private scheduleKeepalive(): void {
    const { clock, session } = this.options;
    this.keepaliveTimer = clock.schedule(clock.now() + KEEPALIVE_SECONDS, () => {
      this.keepaliveTimer = undefined;
      if (this.ended || this.started) return;
      // A keepalive that times out fails the session, which reports it.
      session.keepalive().catch(() => undefined);
      this.scheduleKeepalive();
    });
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer === undefined) return;
    this.options.clock.cancel(this.keepaliveTimer);
    this.keepaliveTimer = undefined;
  }

  private warn(code: MagentaRt2WarningCode): void {
    if (this.ended || this.warned.has(code)) return;
    this.warned.add(code);
    hostCall(() => this.options.onWarning({ code, message: MAGENTA_RT2_WARNING_MESSAGE }));
  }
}
