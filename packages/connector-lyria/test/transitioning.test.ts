import { describe, expect, it, vi } from 'vitest';
import { ConnectorError } from '@luna-estelar/gas-protocol';
import { createPromptTransition, type PromptSender } from '../src/transition.js';
import type { WeightedPrompt } from '../src/prompts.js';
import { VirtualClock } from './support/virtual-clock.js';

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

type SenderCall =
  | { readonly kind: 'send'; readonly prompts: readonly WeightedPrompt[] }
  | { readonly kind: 'play' }
  | { readonly kind: 'pause' };

class RecordingSender implements PromptSender {
  readonly calls: SenderCall[] = [];
  failSendIndices = new Set<number>();
  sendError: unknown = new Error('secret-vendor-text');
  private sendIndex = 0;

  async send(prompts: readonly WeightedPrompt[]): Promise<void> {
    const index = this.sendIndex++;
    this.calls.push({ kind: 'send', prompts });
    if (this.failSendIndices.has(index)) throw this.sendError;
  }

  async requestPlay(): Promise<void> {
    this.calls.push({ kind: 'play' });
  }

  async requestPause(): Promise<void> {
    this.calls.push({ kind: 'pause' });
  }

  get sends(): ReadonlyArray<readonly WeightedPrompt[]> {
    return this.calls
      .filter((call): call is Extract<SenderCall, { kind: 'send' }> => call.kind === 'send')
      .map((call) => call.prompts);
  }
}

function setup(overrides: { durationMs?: number; steps?: number } = {}) {
  const clock = new VirtualClock();
  const sender = new RecordingSender();
  const onFailure = vi.fn();
  const machine = createPromptTransition({
    clock,
    sender,
    onFailure,
    transitionDurationMs: overrides.durationMs ?? 1500,
    transitionSteps: overrides.steps ?? 3
  });
  return { clock, sender, onFailure, machine };
}

describe('prompt transition — stepping', () => {
  it('crossfades an initial set from empty in exact thirds and requests play once', async () => {
    const { clock, sender, machine } = setup();
    machine.beginRun('run-1');

    await machine.update([
      { text: 'a', weight: 3 },
      { text: 'b', weight: 3 }
    ]);

    expect(sender.sends[0]).toEqual([
      { text: 'a', weight: 1 },
      { text: 'b', weight: 1 }
    ]);
    expect(sender.calls[1]).toEqual({ kind: 'play' });
    expect(clock.pendingDeadlines()).toEqual([0.75, 1.5]);

    clock.advanceBy(0.75);
    await flushAsync();
    expect(sender.sends[1]).toEqual([
      { text: 'a', weight: 2 },
      { text: 'b', weight: 2 }
    ]);

    clock.advanceBy(0.75);
    await flushAsync();
    expect(sender.sends[2]).toEqual([
      { text: 'a', weight: 3 },
      { text: 'b', weight: 3 }
    ]);
  });

  it('sends the first mixture before requesting play', async () => {
    const { sender, machine } = setup({ steps: 1 });
    machine.beginRun('run-1');
    await machine.update([{ text: 'a', weight: 2 }]);
    expect(sender.calls[0]).toEqual({ kind: 'send', prompts: [{ text: 'a', weight: 2 }] });
    expect(sender.calls[1]).toEqual({ kind: 'play' });
  });

  it('does nothing for an unchanged target with nothing in flight', async () => {
    const { clock, sender, machine } = setup();
    machine.beginRun('run-1');
    await machine.update([{ text: 'a', weight: 3 }]);
    clock.advanceBy(1.5);
    await flushAsync();
    const before = sender.calls.length;

    await machine.update([{ text: 'a', weight: 3 }]);
    expect(sender.calls.length).toBe(before);
  });

  it('does nothing for an empty target while already empty', async () => {
    const { sender, machine } = setup();
    machine.beginRun('run-1');
    await machine.update([]);
    expect(sender.calls).toEqual([]);
  });
});

describe('prompt transition — interpolation', () => {
  async function seed(
    machine: ReturnType<typeof setup>['machine'],
    clock: VirtualClock,
    prompts: readonly WeightedPrompt[]
  ) {
    await machine.update(prompts);
    clock.advanceBy(1.5);
    await flushAsync();
  }

  it('interpolates over the union of current and target text', async () => {
    const { clock, sender, machine } = setup();
    machine.beginRun('run-1');
    await seed(machine, clock, [{ text: 'a', weight: 3 }]);
    const offset = sender.sends.length;

    await machine.update([
      { text: 'a', weight: 6 },
      { text: 'c', weight: 3 }
    ]);

    expect(sender.sends[offset]).toEqual([
      { text: 'a', weight: 4 },
      { text: 'c', weight: 1 }
    ]);
  });

  it('omits an entry that interpolates to zero at the final step', async () => {
    const { clock, sender, machine } = setup();
    machine.beginRun('run-1');
    await seed(machine, clock, [{ text: 'a', weight: 3 }]);

    await machine.update([{ text: 'b', weight: 3 }]);
    clock.advanceBy(1.5);
    await flushAsync();

    const finalSend = sender.sends[sender.sends.length - 1];
    expect(finalSend).toEqual([{ text: 'b', weight: 3 }]);
  });

  it('rebases a new transition from the exact last emitted mixture', async () => {
    const { clock, sender, machine } = setup();
    machine.beginRun('run-1');
    await machine.update([{ text: 'a', weight: 3 }]);
    clock.advanceBy(0.75);
    await flushAsync();
    expect(machine.lastEmitted()).toEqual([{ text: 'a', weight: 2 }]);
    const offset = sender.sends.length;

    await machine.update([{ text: 'b', weight: 3 }]);

    const rebased = sender.sends[offset];
    expect(rebased[0].text).toBe('a');
    expect(rebased[0].weight).toBeCloseTo(2 + (0 - 2) / 3, 10);
    expect(rebased[1]).toEqual({ text: 'b', weight: 1 });
  });
});

describe('prompt transition — empty target', () => {
  it('fades out then requests pause on the final empty send', async () => {
    const { clock, sender, machine } = setup();
    machine.beginRun('run-1');
    await machine.update([{ text: 'a', weight: 3 }]);
    clock.advanceBy(1.5);
    await flushAsync();
    const offset = sender.calls.length;

    await machine.update([]);
    clock.advanceBy(1.5);
    await flushAsync();

    const tail = sender.calls.slice(offset);
    const lastSend = tail.filter((c) => c.kind === 'send').at(-1);
    expect(lastSend).toEqual({ kind: 'send', prompts: [] });
    expect(tail.at(-1)).toEqual({ kind: 'pause' });
  });
});

describe('prompt transition — collapse', () => {
  it('sends a single full-weight move when steps is one', async () => {
    const { clock, sender, machine } = setup({ steps: 1 });
    machine.beginRun('run-1');
    await machine.update([{ text: 'a', weight: 4 }]);
    expect(sender.sends).toEqual([[{ text: 'a', weight: 4 }]]);
    expect(clock.pendingDeadlines()).toEqual([]);
  });

  it('sends a single full-weight move when duration is zero', async () => {
    const { clock, sender, machine } = setup({ durationMs: 0 });
    machine.beginRun('run-1');
    await machine.update([{ text: 'a', weight: 4 }]);
    expect(sender.sends).toEqual([[{ text: 'a', weight: 4 }]]);
    expect(clock.pendingDeadlines()).toEqual([]);
  });
});

describe('prompt transition — cancellation and staleness', () => {
  it('cancels pending sends of a superseded transition', async () => {
    const { clock, sender, machine } = setup();
    machine.beginRun('run-1');
    await machine.update([{ text: 'a', weight: 3 }]);
    expect(clock.pendingDeadlines()).toEqual([0.75, 1.5]);

    clock.advanceBy(0.8);
    await flushAsync();
    expect(sender.sends.length).toBe(2);

    await machine.update([{ text: 'b', weight: 3 }]);
    expect(clock.pendingDeadlines()).not.toContain(1.5);
    expect(clock.pendingDeadlines()).toEqual([1.55, 2.3]);

    const afterUpdate = sender.sends.length;
    clock.advanceBy(2);
    await flushAsync();
    // Only the new transition's remaining sends fire; the stale 1.5 send never runs.
    expect(sender.sends.length).toBe(afterUpdate + 2);
  });

  it('fires no further sends after the run ends', async () => {
    const { clock, sender, machine } = setup();
    machine.beginRun('run-1');
    await machine.update([{ text: 'a', weight: 3 }]);
    const sent = sender.sends.length;

    machine.endRun('run-1');
    clock.advanceBy(1.5);
    await flushAsync();
    expect(sender.sends.length).toBe(sent);
  });

  it('ignores endRun for a run that is not active', async () => {
    const { clock, sender, machine } = setup();
    machine.beginRun('run-1');
    await machine.update([{ text: 'a', weight: 3 }]);

    machine.endRun('other');
    clock.advanceBy(1.5);
    await flushAsync();
    expect(sender.sends.length).toBe(3);
  });
});

describe('prompt transition — failures', () => {
  it('rejects update and does not report when the first send fails', async () => {
    const { sender, onFailure, machine } = setup();
    sender.failSendIndices = new Set([0]);
    machine.beginRun('run-1');

    await expect(machine.update([{ text: 'a', weight: 3 }])).rejects.toBeInstanceOf(ConnectorError);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('reports a scheduled send failure once and cancels the rest', async () => {
    const { clock, sender, onFailure, machine } = setup();
    sender.failSendIndices = new Set([1]);
    machine.beginRun('run-1');

    await machine.update([{ text: 'a', weight: 3 }]);
    clock.advanceBy(0.75);
    await flushAsync();

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(clock.pendingDeadlines()).toEqual([]);
  });

  it('sanitizes an arbitrary send error into a ConnectorError', async () => {
    const { clock, sender, onFailure, machine } = setup();
    sender.failSendIndices = new Set([1]);
    sender.sendError = new Error('secret-vendor-text');
    machine.beginRun('run-1');

    await machine.update([{ text: 'a', weight: 3 }]);
    clock.advanceBy(0.75);
    await flushAsync();

    const error = onFailure.mock.calls[0][0] as ConnectorError;
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error.code).toBe('lyria-prompt-send-failed');
    expect(error.reason).toBe('internal');
    expect(JSON.stringify(error)).not.toContain('secret-vendor-text');
    expect(error.message).not.toContain('secret-vendor-text');
  });

  it('passes a thrown ConnectorError through with its reason', async () => {
    const { clock, sender, onFailure, machine } = setup();
    sender.failSendIndices = new Set([1]);
    sender.sendError = new ConnectorError({ code: 'quota', reason: 'quota', retryable: true });
    machine.beginRun('run-1');

    await machine.update([{ text: 'a', weight: 3 }]);
    clock.advanceBy(0.75);
    await flushAsync();

    const error = onFailure.mock.calls[0][0] as ConnectorError;
    expect(error.reason).toBe('quota');
    expect(error.retryable).toBe(true);
  });

  it('reports at most once per run and resets on the next run', async () => {
    const { clock, sender, onFailure, machine } = setup();
    sender.failSendIndices = new Set([1, 3]);
    machine.beginRun('run-1');

    await machine.update([{ text: 'a', weight: 3 }]);
    clock.advanceBy(0.75);
    await flushAsync();
    expect(onFailure).toHaveBeenCalledTimes(1);

    // A second transition in the same run fails again but stays silent.
    await machine.update([{ text: 'b', weight: 3 }]);
    clock.advanceBy(0.75);
    await flushAsync();
    expect(onFailure).toHaveBeenCalledTimes(1);

    machine.endRun('run-1');
    machine.beginRun('run-2');
    sender.failSendIndices = new Set([sender.sends.length + 1]);
    await machine.update([{ text: 'c', weight: 3 }]);
    clock.advanceBy(0.75);
    await flushAsync();
    expect(onFailure).toHaveBeenCalledTimes(2);
  });
});

describe('prompt transition — lifecycle guards', () => {
  it('throws when updating with no active run', async () => {
    const { machine } = setup();
    await expect(machine.update([{ text: 'a', weight: 1 }])).rejects.toBeInstanceOf(ConnectorError);
  });

  it('throws when beginning a run while one is active', () => {
    const { machine } = setup();
    machine.beginRun('run-1');
    expect(() => machine.beginRun('run-2')).toThrow(ConnectorError);
  });
});
