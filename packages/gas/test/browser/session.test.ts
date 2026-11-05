// The browser session over the real session, a fake connector and a
// scripted audio device. Device time and wall-time timeouts advance together,
// because the session and the engine both run on an AudioClock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserSession, type BrowserSession } from '../../src/browser/session.js';
import { AudioClock } from '../../src/browser/audio/clock.js';
import {
  ConnectorError,
  type AudiblePositionEvent,
  type ConnectorConfigValidation,
  type GenerationPositionEvent
} from '../../src/protocol/index.js';
import { OPENING_REST } from '../api/session/support/harness.js';
import { FakeAudioContext } from './support/fake-audio-context.js';
import {
  FakeConnector,
  type FakeConnection,
  type FakeConnectorOptions
} from '../../../../test/support/fake-connection.js';
import { testTimeline } from '../../../../test/support/timeline.js';

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

interface Recorded<T> {
  /** Device time when the event was emitted. */
  readonly at: number;
  readonly event: T;
}

interface Harness {
  readonly context: FakeAudioContext;
  readonly connector: FakeConnector;
  readonly browser: BrowserSession;
  readonly generated: Recorded<GenerationPositionEvent>[];
  readonly heard: Recorded<AudiblePositionEvent>[];
  /** The connection of the current Play. */
  connection(): FakeConnection;
  /** Deliver `seconds` of audio on the current connection. */
  deliver(seconds?: number): void;
}

const FAILURE = new ConnectorError({
  code: 'generation-failed',
  reason: 'provider',
  retryable: true
});

const NO_CONFIG = (): ConnectorConfigValidation => ({
  ok: false,
  problems: [{ path: '/bad', code: 'unknown-member', message: 'Not a member.' }]
});

async function harness(
  options: {
    readonly connector?: FakeConnectorOptions;
    readonly declaredBars?: number;
    /** GAS source to load instead of the default timeline. */
    readonly source?: string;
    readonly outputLatency?: number;
  } = {}
): Promise<Harness> {
  const context = new FakeAudioContext();
  if (options.outputLatency !== undefined) context.outputLatency = options.outputLatency;
  const connector = new FakeConnector(options.connector);
  const browser = await createBrowserSession({ connector, context: context.asContext() });
  const generated: Recorded<GenerationPositionEvent>[] = [];
  const heard: Recorded<AudiblePositionEvent>[] = [];
  browser.session.on('generationPosition', (event) =>
    generated.push({ at: context.currentTime, event })
  );
  browser.session.on('audiblePosition', (event) => heard.push({ at: context.currentTime, event }));
  if (options.source !== undefined) {
    await browser.session.loadSource(options.source);
  } else {
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
  }
  return {
    context,
    connector,
    browser,
    generated,
    heard,
    connection: () => connector.latest(),
    deliver(seconds = 2) {
      connector.latest().pushAudio(seconds);
    }
  };
}

describe('composition', () => {
  it('plays session audio through the engine and places the audible playhead musically', async () => {
    const { context, browser, deliver, heard } = await harness();
    await browser.session.play();
    expect(heard).toEqual([]);

    deliver();
    await advanceTo(context, 2);
    deliver();
    expect(context.started.map((source) => source.startedAt)).toEqual([2.05, 4.05]);

    // One second into the audio: beat 3 of bar 1 at 120 BPM in 4/4.
    await advanceTo(context, 3.05);
    const audible = heard.at(-1)?.event;
    expect(audible?.seconds).toBeCloseTo(1, 6);
    expect(audible?.position).toEqual({ bar: 1, beat: { index: 3 } });
    await browser.close();
  });

  it('places the playhead from the next Play after a failure', async () => {
    const { context, browser, connector, connection, deliver, heard } = await harness();
    await browser.session.play();
    deliver();
    connection().fail(FAILURE);
    await vi.advanceTimersByTimeAsync(0);
    expect(browser.session.getState().ended).toBe('failed');

    await browser.session.play();
    expect(connector.connections).toHaveLength(2);
    const runStart = context.currentTime;
    deliver();
    deliver();
    await advanceTo(context, runStart + 0.05 + 2.5);
    expect(heard.at(-1)?.event.position).toEqual({ bar: 2, beat: { index: 2 } });
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

    const browser = await createBrowserSession({ connector: new FakeConnector() });
    expect(created[0]?.resumes).toBe(1);
    await browser.close();
    expect(created[0]?.closes).toBe(1);

    await expect(
      createBrowserSession({
        connector: new FakeConnector({ validateConfig: NO_CONFIG }),
        connectorConfig: { bad: true }
      })
    ).rejects.toThrow();
    expect(created[1]?.closes).toBe(1);
    // The engine was built before the session failed, and was closed with it.
    expect(created[1]?.master.disconnected).toBe(1);
  });

  it('closes the engine but not an adopted context when the start fails', async () => {
    const context = new FakeAudioContext();
    await expect(
      createBrowserSession({
        connector: new FakeConnector({ validateConfig: NO_CONFIG }),
        connectorConfig: { bad: true },
        context: context.asContext()
      })
    ).rejects.toThrow();
    expect(context.closes).toBe(0);
    expect(context.master.disconnected).toBe(1);
  });
});

describe('stopping and ending', () => {
  it('stops before anything plays when the app stops mid-buffer', async () => {
    const { context, browser, deliver } = await harness();
    await browser.session.play();
    deliver();
    await advanceTo(context, 0.5);
    await browser.session.stop();
    await advanceTo(context, 5);
    expect(context.started).toEqual([]);
    expect(context.master.gain.value).toBe(0);
    expect(browser.audio.status().state).toBe('stopped');
    await browser.close();
  });

  it('silences playing audio on close before the connector finishes stopping', async () => {
    const { context, browser, deliver } = await harness({
      connector: { closeHangs: true }
    });
    await browser.session.play();
    deliver();
    deliver();
    await advanceTo(context, 1);
    expect(context.started).toHaveLength(2);

    // The connection never finishes closing.
    const closing = browser.close();
    const closedAt = context.currentTime;
    for (const source of context.started) expect(source.stoppedAt).toBeCloseTo(closedAt + 0.02, 9);

    await advanceTo(context, 7);
    await closing;
  });

  it('silences playing audio within the ramp when the app stops', async () => {
    const { context, browser, deliver } = await harness();
    await browser.session.play();
    deliver();
    deliver();
    await advanceTo(context, 1);
    await browser.session.stop();
    const stoppedAt = context.currentTime;
    expect(context.started).toHaveLength(2);
    for (const source of context.started) expect(source.stoppedAt).toBeCloseTo(stoppedAt + 0.02, 9);
    await advanceTo(context, 5);
    expect(context.started).toHaveLength(2);
    await browser.close();
  });

  it('plays a second Play at full gain after stopping the first', async () => {
    const { context, browser, connector, deliver } = await harness();
    await browser.session.play();
    deliver();
    deliver();
    await advanceTo(context, 1);
    await browser.session.stop();
    const runA = [...context.started];

    await browser.session.play();
    expect(connector.connections.map((c) => c.closed)).toEqual([true, false]);
    await advanceTo(context, 1.5);
    deliver();
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
    const ended: string[] = [];
    browser.session.on('state', (state) => {
      if (state.status === 'stopped' && state.ended !== undefined) ended.push(state.ended);
    });
    await browser.session.play();
    deliver();
    deliver();
    // Two bars at 120 BPM end the piece 4 s after the anchor; the audio started
    // 50 ms after it, so the last 50 ms is still to be heard.
    await advanceTo(context, 4.01);
    expect(ended).toEqual(['finished']);
    expect(browser.audio.status().state).toBe('playing');

    await advanceTo(context, 4.1);
    expect(browser.audio.status().state).toBe('stopped');
    expect(context.started.every((source) => source.stoppedAt === undefined)).toBe(true);
    await browser.close();
  });

  // Real-time delivery: the renderer completes at 4 s, but the listener is two
  // seconds of prebuffer behind and hears the piece until 6.05 s.
  it('keeps placing the playhead while a finished piece plays out', async () => {
    const { context, browser, deliver, heard } = await harness({ declaredBars: 2 });
    await browser.session.play();
    deliver();
    await advanceTo(context, 2);
    deliver();
    await advanceTo(context, 4.01);
    expect(browser.session.getState()).toMatchObject({ status: 'stopped', ended: 'finished' });

    await advanceTo(context, 5.05);
    expect(heard.at(-1)?.event).toEqual({
      position: { bar: 2, beat: { index: 3 } },
      seconds: expect.closeTo(3, 6),
      loopIteration: 1
    });
    await advanceTo(context, 6.1);
    expect(browser.audio.status().state).toBe('stopped');
    const last = heard.at(-1)!;
    expect(last.event.position).toEqual({ bar: 3 });
    expect(last.at).toBeCloseTo(6.05, 2);
    const count = heard.length;
    await advanceTo(context, 8);
    expect(heard).toHaveLength(count);
    await browser.close();
  });

  it('silences the tail of a finished piece when the app stops', async () => {
    const { context, browser, deliver, heard } = await harness({ declaredBars: 2 });
    await browser.session.play();
    deliver();
    await advanceTo(context, 2);
    deliver();
    await advanceTo(context, 5);
    await browser.session.stop();
    // Chunk 0 finished at 4.05; chunk 1 was still playing.
    expect(context.started[1]!.stoppedAt).toBeCloseTo(5.02, 9);
    const count = heard.length;
    await advanceTo(context, 7);
    expect(heard).toHaveLength(count);
    await browser.close();
  });

  it('flushes when the connection fails mid-Play', async () => {
    const { context, browser, connection, deliver } = await harness();
    await browser.session.play();
    deliver();
    deliver();
    await advanceTo(context, 1);
    connection().fail(FAILURE);
    await vi.advanceTimersByTimeAsync(0);
    for (const source of context.started) expect(source.stoppedAt).toBeCloseTo(1.02, 9);
    await advanceTo(context, 1.1);
    expect(context.started.every((source) => source.ended)).toBe(true);
    await browser.close();
  });
});

describe('audible position', () => {
  /** Deliver a 2 s chunk every 2 s, as a real-time model would, until `until`. */
  async function realTime(h: Harness, until: number): Promise<void> {
    for (let at = h.context.currentTime; at < until; at += 2) {
      h.deliver();
      await advanceTo(h.context, Math.min(at + 2, until));
    }
  }

  // The advance steps are 10 ms, so an event lands at most one step late.
  function expectTrailing(h: Harness, gap: number): void {
    expect(h.heard.length).toBeGreaterThan(0);
    for (const { at, event } of h.heard) {
      expect(at - event.seconds).toBeGreaterThanOrEqual(gap - 0.001);
      expect(at - event.seconds).toBeLessThanOrEqual(gap + 0.011);
    }
  }

  it('reports each beat as it is heard, the prebuffer and start lead behind', async () => {
    const h = await harness();
    await h.browser.session.play();
    await realTime(h, 6.1);
    expectTrailing(h, 2.05);
    // Every beat of the first two bars, in order, at 120 BPM.
    expect(h.heard.slice(0, 8).map(({ event }) => event.seconds)).toEqual(
      [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((seconds) => expect.closeTo(seconds, 6))
    );
    expect(h.heard[4]!.event.position).toEqual({ bar: 2 });
    // The session's own generation events come through unchanged.
    for (const { event } of h.generated) {
      if (event.seconds < 4) expect(h.heard.map((r) => r.event)).toContainEqual(event);
    }
    await h.browser.close();
  });

  it('trails by the output latency too', async () => {
    const h = await harness({ outputLatency: 0.1 });
    await h.browser.session.play();
    await realTime(h, 6.1);
    expectTrailing(h, 2.15);
    await h.browser.close();
  });

  it('reports nothing before the first audio is heard', async () => {
    const h = await harness();
    await h.browser.session.play();
    await advanceTo(h.context, 3);
    expect(h.heard).toEqual([]);
    await h.browser.close();
  });

  it('drops what was generated but not heard when the app stops', async () => {
    const h = await harness();
    await h.browser.session.play();
    await realTime(h, 3);
    await h.browser.session.stop();
    const heardBeforeStop = h.heard.length;
    await advanceTo(h.context, 6);
    expect(h.heard).toHaveLength(heardBeforeStop);

    await h.browser.session.play();
    const runStart = h.context.currentTime;
    await realTime(h, runStart + 2.1);
    const next = h.heard.slice(heardBeforeStop);
    expect(next[0]!.event).toEqual({ position: { bar: 1 }, seconds: 0, loopIteration: 1 });
    expect(next[0]!.at - runStart).toBeCloseTo(2.05, 1);
    await h.browser.close();
  });

  it('reports nothing after a failure', async () => {
    const h = await harness();
    await h.browser.session.play();
    await realTime(h, 3);
    h.connection().fail(FAILURE);
    await vi.advanceTimersByTimeAsync(0);
    const count = h.heard.length;
    await advanceTo(h.context, 8);
    expect(h.heard).toHaveLength(count);
    await h.browser.close();
  });

  it('holds through an underrun and goes on once the next chunk is heard', async () => {
    const h = await harness();
    await h.browser.session.play();
    h.deliver();
    // The chunk plays from 2.05 to 4.05, then the chain runs dry.
    await advanceTo(h.context, 6);
    const held = h.heard.at(-1)!;
    expect(held.event.seconds).toBeCloseTo(2, 6);
    expect(held.event.position).toEqual({ bar: 2 });
    expect(held.at).toBeCloseTo(4.05, 1);

    h.deliver();
    await advanceTo(h.context, 7.9);
    expect(h.heard.at(-1)).toBe(held);
    // Rebuffered for 2 s, then heard 50 ms after that.
    await advanceTo(h.context, 8.7);
    const resumed = h.heard.slice(h.heard.indexOf(held) + 1);
    expect(resumed[0]!.event.seconds).toBeCloseTo(2.5, 6);
    expect(resumed[0]!.at).toBeCloseTo(8.55, 1);
    await h.browser.close();
  });

  it('reports the beats of an opening rest as its silence plays', async () => {
    const h = await harness({ source: OPENING_REST });
    await h.browser.session.play();
    await advanceTo(h.context, 3.6);
    expect(h.heard.slice(0, 4).map(({ event }) => event.position)).toEqual([
      { bar: 1 },
      { bar: 1, beat: { index: 2 } },
      { bar: 1, beat: { index: 3 } },
      { bar: 1, beat: { index: 4 } }
    ]);
    // GAS hands out its silence ahead, so the prebuffer fills at once and only
    // the start lead is left.
    expectTrailing(h, 0.05);
    await h.browser.close();
  });

  it('reports nothing after close', async () => {
    const h = await harness();
    await h.browser.session.play();
    await realTime(h, 3);
    await h.browser.close();
    const count = h.heard.length;
    await advanceTo(h.context, 8);
    expect(h.heard).toHaveLength(count);
  });
});
