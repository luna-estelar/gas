// The browser session over the real session, a fake connector and a
// scripted audio device. Device time and wall-time timeouts advance together,
// because the session and the engine both run on an AudioClock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserSession, type BrowserSession } from '../../src/browser/session.js';
import { ConnectorError, type ConnectorConfigValidation } from '../../src/protocol/index.js';
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

interface Harness {
  readonly context: FakeAudioContext;
  readonly connector: FakeConnector;
  readonly browser: BrowserSession;
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
  } = {}
): Promise<Harness> {
  const context = new FakeAudioContext();
  const connector = new FakeConnector(options.connector);
  const browser = await createBrowserSession({ connector, context: context.asContext() });
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
  return {
    context,
    connector,
    browser,
    connection: () => connector.latest(),
    deliver(seconds = 2) {
      connector.latest().pushAudio(seconds);
    }
  };
}

describe('composition', () => {
  it('plays session audio through the engine and places the audible playhead musically', async () => {
    const { context, browser, deliver } = await harness();
    await browser.session.play();
    expect(browser.audiblePosition()).toBeUndefined();

    deliver();
    await advanceTo(context, 2);
    deliver();
    expect(context.started.map((source) => source.startedAt)).toEqual([2.05, 4.05]);

    // One second into the audio: beat 3 of bar 1 at 120 BPM in 4/4.
    await advanceTo(context, 3.05);
    const audible = browser.audiblePosition();
    expect(audible?.seconds).toBeCloseTo(1, 6);
    expect(audible?.position).toEqual({ bar: 1, beat: { index: 3 } });
    await browser.close();
  });

  it('places the playhead from the next Play after a failure', async () => {
    const { context, browser, connector, connection, deliver } = await harness();
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
    const { context, browser, deliver } = await harness({ declaredBars: 2 });
    await browser.session.play();
    deliver();
    await advanceTo(context, 2);
    deliver();
    await advanceTo(context, 4.01);
    expect(browser.session.getState()).toMatchObject({ status: 'stopped', ended: 'finished' });

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

  it('silences the tail of a finished piece when the app stops', async () => {
    const { context, browser, deliver } = await harness({ declaredBars: 2 });
    await browser.session.play();
    deliver();
    await advanceTo(context, 2);
    deliver();
    await advanceTo(context, 5);
    await browser.session.stop();
    // Chunk 0 finished at 4.05; chunk 1 was still playing.
    expect(context.started[1]!.stoppedAt).toBeCloseTo(5.02, 9);
    expect(browser.audiblePosition()).toBeUndefined();
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
