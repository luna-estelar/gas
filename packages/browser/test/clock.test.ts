// AudioClock: wall-time timeouts checked against device time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioClock } from '../src/audio/clock.js';
import { detectSupport, openAudioContext } from '../src/audio/context.js';

class FakeDocument {
  visibilityState: 'visible' | 'hidden' = 'visible';
  readonly listeners = new Set<() => void>();

  addEventListener(event: string, listener: () => void) {
    if (event === 'visibilitychange') this.listeners.add(listener);
  }

  removeEventListener(event: string, listener: () => void) {
    if (event === 'visibilitychange') this.listeners.delete(listener);
  }

  show() {
    this.visibilityState = 'visible';
    for (const listener of this.listeners) listener();
  }
}

const context = { currentTime: 0 };
const clockOn = () => new AudioClock(context as unknown as BaseAudioContext);

beforeEach(() => {
  vi.useFakeTimers();
  context.currentTime = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AudioClock', () => {
  it('reads device time', () => {
    context.currentTime = 3.5;
    expect(clockOn().now()).toBe(3.5);
  });

  it('waits again when the timeout fires before the device reaches the deadline', () => {
    const clock = clockOn();
    const fired = vi.fn();
    clock.schedule(1, fired);

    // The device ran slow: a second of wall time is 0.6 s of device time.
    context.currentTime = 0.6;
    vi.advanceTimersByTime(1000);
    expect(fired).not.toHaveBeenCalled();

    context.currentTime = 1;
    vi.advanceTimersByTime(400);
    expect(fired).toHaveBeenCalledOnce();
  });

  it('cancels a timer', () => {
    const clock = clockOn();
    const fired = vi.fn();
    const timer = clock.schedule(1, fired);
    clock.cancel(timer);
    context.currentTime = 2;
    vi.advanceTimersByTime(2000);
    expect(fired).not.toHaveBeenCalled();
  });

  it('runs overdue timers, in deadline order, when the page becomes visible again', () => {
    const document = new FakeDocument();
    vi.stubGlobal('document', document);
    const clock = clockOn();
    const order: number[] = [];
    clock.schedule(2, () => order.push(2));
    clock.schedule(1, () => order.push(1));
    clock.schedule(9, () => order.push(9));

    // A background tab: device time moved on, the throttled timeouts did not.
    document.visibilityState = 'hidden';
    context.currentTime = 5;
    document.show();
    expect(order).toEqual([1, 2]);
    vi.advanceTimersByTime(2000);
    expect(order).toEqual([1, 2]);
  });

  it('dispose clears every timer and the visibility listener', () => {
    const document = new FakeDocument();
    vi.stubGlobal('document', document);
    const clock = clockOn();
    const fired = vi.fn();
    clock.schedule(1, fired);
    expect(document.listeners.size).toBe(1);

    clock.dispose();
    expect(document.listeners.size).toBe(0);
    context.currentTime = 2;
    vi.advanceTimersByTime(2000);
    expect(fired).not.toHaveBeenCalled();
  });
});

describe('opening a context', () => {
  it('asks to resume before yielding, with a playback latency hint', async () => {
    const created: Array<{ options: unknown; resumes: number; state: string }> = [];
    class StubContext {
      state = 'suspended';
      resumes = 0;
      constructor(readonly options: unknown) {
        created.push(this);
      }
      resume() {
        this.resumes++;
        this.state = 'running';
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', StubContext);

    const opening = openAudioContext({ sampleRate: 44_100 });
    expect(created[0]?.resumes).toBe(1);
    const { context: opened, resumed } = await opening;
    expect(resumed).toBe(true);
    expect((opened as unknown as StubContext).options).toEqual({
      latencyHint: 'playback',
      sampleRate: 44_100
    });
  });

  it('reports a context the browser would not start', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'suspended';
        resume() {
          return Promise.reject(new Error('no gesture'));
        }
      }
    );
    expect((await openAudioContext()).resumed).toBe(false);
  });

  it('detects the browser APIs a session needs', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(detectSupport()).toEqual({
      audioContext: false,
      webSocket: typeof WebSocket === 'function',
      atob: true
    });
  });
});
