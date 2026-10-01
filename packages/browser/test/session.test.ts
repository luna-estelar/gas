// The browser session over the real api and renderer, a fake connector and a
// scripted audio device. Device time and wall-time timeouts advance together,
// because the renderer and the engine both run on an AudioClock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserSession, type BrowserSession } from '../src/session.js';
import { FakeAudioContext, pcmChunk } from './support/fake-audio-context.js';
import { FakeConnector, type FakeConnectorOptions } from '../../../test/support/fake-connector.js';
import { testTimeline } from '../../../test/support/timeline.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Whole milliseconds, so device time lands exactly on the deadlines tests name
// instead of a float's width short of them.
async function advanceTo(context: FakeAudioContext, time: number): Promise<void> {
  const target = Math.round(time * 1000);
  for (let now = Math.round(context.currentTime * 1000); now < target;) {
    const next = Math.min(target, now + 10);
    context.advanceTo(next / 1000);
    await vi.advanceTimersByTimeAsync(next - now);
    now = next;
  }
}

interface Harness {
  readonly context: FakeAudioContext;
  readonly connectors: FakeConnector[];
  readonly browser: BrowserSession;
  /** The connector the current renderer runs on. */
  connector(): FakeConnector;
  /** Deliver chunk `sequence` of the current run from the connector. */
  deliver(sequence: number, seconds?: number): void;
}

async function harness(
  options: {
    readonly connector?: FakeConnectorOptions;
    readonly declaredBars?: number;
  } = {}
): Promise<Harness> {
  const context = new FakeAudioContext();
  const connectors: FakeConnector[] = [];
  const browser = await createBrowserSession({
    connector: () => {
      const connector = new FakeConnector(options.connector);
      connectors.push(connector);
      return connector;
    },
    settings: {},
    context: context.asContext()
  });
  const bars = options.declaredBars ?? 4;
  await browser.session.loadTimeline(
    testTimeline({
      playback: { mode: 'finite', declaredBars: bars },
      arrangedBars: bars,
      arrangement: [
        {
          sectionInstanceId: 'section.main.0',
          sectionName: 'main',
          callIndex: 0,
          start: { bar: 1 },
          end: { bar: bars + 1 }
        }
      ]
    })
  );
  const current = () => connectors.at(-1)!;
  return {
    context,
    connectors,
    browser,
    connector: current,
    deliver(sequence, seconds = 2) {
      const connector = current();
      connector.sink!.push(pcmChunk(sequence, { runId: connector.runId!, seconds }));
    }
  };
}

describe('composition', () => {
  it('plays renderer audio through the engine and places the audible playhead musically', async () => {
    const { context, browser, deliver } = await harness();
    await browser.session.play();
    expect(browser.audiblePosition()).toBeUndefined();

    deliver(0);
    await advanceTo(context, 2);
    deliver(1);
    expect(context.started.map((source) => source.startedAt)).toEqual([2.05, 4.05]);

    // One second into the audio: beat 3 of bar 1 at 120 BPM in 4/4.
    await advanceTo(context, 3.05);
    const audible = browser.audiblePosition();
    expect(audible?.seconds).toBeCloseTo(1, 6);
    expect(audible?.position).toEqual({ bar: 1, beat: { index: 3 } });
    await browser.close();
  });

  it('asks the renderer built after a retry for the playhead', async () => {
    const { context, browser, connectors, connector, deliver } = await harness();
    await browser.session.play();
    deliver(0);
    connector().sink!.failure({
      code: 'generation-failed',
      message: 'Audio generation failed.',
      retryable: true,
      runId: connector().runId!
    });
    await vi.advanceTimersByTimeAsync(0);
    await browser.session.retryRenderer();
    expect(connectors).toHaveLength(2);

    await browser.session.play();
    const runStart = context.currentTime;
    deliver(0);
    deliver(1);
    await advanceTo(context, runStart + 0.05 + 2.5);
    expect(browser.audiblePosition()?.position).toEqual({ bar: 2, beat: { index: 2 } });
    await browser.close();
  });

  it('adopts a context without closing it', async () => {
    const { context, browser } = await harness();
    await browser.close();
    expect(context.closes).toBe(0);
    expect(context.master.disconnected).toBe(1);
  });

  it('closes a context it opened, on close and on a failed start', async () => {
    const created: FakeAudioContext[] = [];
    vi.stubGlobal(
      'AudioContext',
      class extends FakeAudioContext {
        constructor() {
          super();
          created.push(this);
        }
      }
    );

    const browser = await createBrowserSession({ connector: new FakeConnector(), settings: {} });
    expect(created[0]?.resumes).toBe(1);
    await browser.close();
    expect(created[0]?.closes).toBe(1);

    await expect(
      createBrowserSession({
        connector: new FakeConnector({ openFailure: new Error('bad key') }),
        settings: {}
      })
    ).rejects.toThrow();
    expect(created[1]?.closes).toBe(1);
    // The engine was built before the renderer failed, and was closed with it.
    expect(created[1]?.master.disconnected).toBe(1);
  });

  it('closes the engine but not an adopted context when the start fails', async () => {
    const context = new FakeAudioContext();
    await expect(
      createBrowserSession({
        connector: new FakeConnector({ openFailure: new Error('bad key') }),
        settings: {},
        context: context.asContext()
      })
    ).rejects.toThrow();
    expect(context.closes).toBe(0);
    expect(context.master.disconnected).toBe(1);
  });
});

describe('lifecycle', () => {
  it('stops before anything plays when the host stops mid-buffer', async () => {
    const { context, browser, deliver } = await harness();
    await browser.session.play();
    deliver(0);
    await advanceTo(context, 0.5);
    await browser.session.stop();
    await advanceTo(context, 5);
    expect(context.started).toEqual([]);
    expect(context.master.gain.value).toBe(0);
    expect(browser.audio.status().state).toBe('stopped');
    await browser.close();
  });

  it('silences playing audio within the ramp when the host stops', async () => {
    const { context, browser, deliver } = await harness();
    await browser.session.play();
    deliver(0);
    deliver(1);
    await advanceTo(context, 1);
    await browser.session.stop();
    const stoppedAt = context.currentTime;
    expect(context.started).toHaveLength(2);
    for (const source of context.started) expect(source.stoppedAt).toBeCloseTo(stoppedAt + 0.02, 9);
    await advanceTo(context, 5);
    expect(context.started).toHaveLength(2);
    await browser.close();
  });

  it('plays a second run at full gain after stopping the first', async () => {
    const { context, browser, connector, deliver } = await harness();
    await browser.session.play();
    deliver(0);
    deliver(1);
    await advanceTo(context, 1);
    await browser.session.stop();
    const runA = [...context.started];

    await browser.session.play();
    expect(connector().calls.filter((call) => call.startsWith('stop:'))).toHaveLength(1);
    await advanceTo(context, 1.5);
    deliver(0);
    await advanceTo(context, 3.5);
    const runB = context.started.filter((source) => !runA.includes(source));
    expect(runB).toHaveLength(1);
    expect(runB[0]!.startedAt).toBeCloseTo(1.5 + 2 + 0.05, 9);
    expect(context.master.gain.calls.at(-1)).toEqual(['set', 1, runB[0]!.startedAt]);
    expect(runA.every((source) => source.ended)).toBe(true);
    await browser.close();
  });

  it('plays out the tail of a finished piece instead of cutting it', async () => {
    const { context, browser, deliver } = await harness({ declaredBars: 2 });
    const completed: boolean[] = [];
    browser.session.on('lifecycle', (event) => {
      if (event.completed === true) completed.push(true);
    });
    await browser.session.play();
    deliver(0);
    deliver(1);
    // Two bars at 120 BPM end the piece 4 s after the anchor; the audio started
    // 50 ms after it, so the last 50 ms is still to be heard.
    await advanceTo(context, 4.01);
    expect(completed).toEqual([true]);
    expect(browser.session.getState().playback).toBe('stopped');
    expect(browser.audio.status().state).toBe('playing');

    await advanceTo(context, 4.1);
    expect(browser.audio.status().state).toBe('stopped');
    expect(context.started.every((source) => source.stoppedAt === undefined)).toBe(true);
    await browser.close();
  });

  // Real-time delivery: the renderer completes at 4 s, but the listener is two
  // seconds of prebuffer behind and hears the piece until 6.05 s.
  it('keeps placing the playhead while a finished piece plays out', async () => {
    const { context, browser, deliver } = await harness({ declaredBars: 2 });
    await browser.session.play();
    deliver(0);
    await advanceTo(context, 2);
    deliver(1);
    await advanceTo(context, 4.01);
    expect(browser.session.getState().playback).toBe('stopped');

    await advanceTo(context, 5.05);
    expect(browser.audiblePosition()).toEqual({
      position: { bar: 2, beat: { index: 3 } },
      seconds: expect.closeTo(3, 6)
    });
    await advanceTo(context, 6.1);
    expect(browser.audio.status().state).toBe('stopped');
    expect(browser.audiblePosition()?.position).toEqual({ bar: 3 });
    await browser.close();
  });

  it('silences the tail of a finished piece when the host stops', async () => {
    const { context, browser, deliver } = await harness({ declaredBars: 2 });
    await browser.session.play();
    deliver(0);
    await advanceTo(context, 2);
    deliver(1);
    await advanceTo(context, 5);
    await browser.session.stop();
    // Chunk 0 finished at 4.05; chunk 1 was still playing.
    expect(context.started[1]!.stoppedAt).toBeCloseTo(5.02, 9);
    expect(browser.audiblePosition()).toBeUndefined();
    await browser.close();
  });

  it('flushes when the renderer fails mid-run', async () => {
    const { context, browser, connector, deliver } = await harness();
    await browser.session.play();
    deliver(0);
    deliver(1);
    await advanceTo(context, 1);
    connector().sink!.failure({
      code: 'generation-failed',
      message: 'Audio generation failed.',
      retryable: true,
      runId: connector().runId!
    });
    await vi.advanceTimersByTimeAsync(0);
    for (const source of context.started) expect(source.stoppedAt).toBeCloseTo(1.02, 9);
    await advanceTo(context, 1.1);
    expect(context.started.every((source) => source.ended)).toBe(true);
    await browser.close();
  });
});
