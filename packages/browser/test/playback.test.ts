import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioChunk } from '@luna-estelar/gas-protocol';
import { AudioContextClock, PcmPlayback } from '../src/playback.js';
import { PcmCapture } from '../src/audio.js';

class FakeAudioParam {
  value = 1;
  readonly calls: Array<readonly [string, ...number[]]> = [];

  cancelScheduledValues(time: number) {
    this.calls.push(['cancel', time]);
  }

  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.calls.push(['set', value, time]);
  }

  linearRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.calls.push(['ramp', value, time]);
  }
}

class FakeGain {
  readonly gain = new FakeAudioParam();
  connected: unknown;

  connect(destination: unknown) {
    this.connected = destination;
  }
}

class FakeBuffer {
  readonly channels: Float32Array[];
  readonly duration: number;

  constructor(
    channelCount: number,
    readonly frames: number,
    readonly sampleRate: number
  ) {
    this.channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
    this.duration = frames / sampleRate;
  }

  getChannelData(channel: number) {
    return this.channels[channel]!;
  }
}

class FakeSource {
  buffer: FakeBuffer | null = null;
  connected: unknown;
  readonly starts: number[] = [];
  stops = 0;
  onended: (() => void) | null = null;

  connect(destination: unknown) {
    this.connected = destination;
  }

  start(time: number) {
    this.starts.push(time);
  }

  stop() {
    this.stops += 1;
  }
}

class FakeContext {
  currentTime = 2;
  readonly destination = {};
  readonly gain = new FakeGain();
  readonly buffers: FakeBuffer[] = [];
  readonly sources: FakeSource[] = [];
  closes = 0;

  createGain() {
    return this.gain;
  }

  createBuffer(channels: number, frames: number, sampleRate: number) {
    const buffer = new FakeBuffer(channels, frames, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  async close() {
    this.closes += 1;
  }
}

function chunk(
  runId: string,
  samples: readonly number[],
  channels = 2,
  sampleRate = 2
): AudioChunk {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return {
    runId,
    sequence: 0,
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate,
    channels,
    bytes,
    durationSeconds: samples.length / channels / sampleRate
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis)
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Web Audio playback', () => {
  it('uses AudioContext time for renderer deadlines', async () => {
    const context = new FakeContext();
    const callback = vi.fn();
    const clock = new AudioContextClock(context as unknown as BaseAudioContext);
    expect(clock.now()).toBe(2);
    clock.schedule(2.5, callback);
    await vi.advanceTimersByTimeAsync(499);
    expect(callback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('converts interleaved s16le PCM and schedules chunks gaplessly', () => {
    const context = new FakeContext();
    const playback = new PcmPlayback(context as unknown as AudioContext);
    playback.push(chunk('run-a', [-32768, 16384, 32767, -16384]));
    playback.push(chunk('run-a', [0, 0, 0, 0]));

    expect([...context.buffers[0]!.getChannelData(0)]).toEqual([-1, 32767 / 32768]);
    expect([...context.buffers[0]!.getChannelData(1)]).toEqual([0.5, -0.5]);
    expect(context.sources[0]!.starts[0]).toBeCloseTo(2.08);
    expect(context.sources[1]!.starts[0]).toBeCloseTo(3.08);
  });

  it('flushes scheduled audio when a stale run is replaced or playback closes', async () => {
    const context = new FakeContext();
    const playback = new PcmPlayback(context as unknown as AudioContext);
    playback.push(chunk('run-a', [0, 0]));
    context.currentTime = 5;
    playback.push(chunk('run-b', [0, 0]));

    expect(context.sources[0]!.stops).toBe(1);
    expect(context.sources[1]!.starts[0]).toBeCloseTo(5.08);
    await playback.close();
    expect(context.sources[1]!.stops).toBe(1);
    expect(context.closes).toBe(1);
  });

  it('ramps the master gain over the requested ending fade', async () => {
    const context = new FakeContext();
    const playback = new PcmPlayback(context as unknown as AudioContext);
    const fading = playback.fadeOut(1.2);
    expect(context.gain.gain.calls).toContainEqual(['ramp', 0, 3.2]);
    await vi.advanceTimersByTimeAsync(1200);
    await fading;
  });

  it('records only what it schedules when a capture is supplied', () => {
    const context = new FakeContext();
    const capture = new PcmCapture();
    const playback = new PcmPlayback(context as unknown as AudioContext, capture);

    // Rejected before scheduling, so it must not reach the recording either.
    playback.push({ ...chunk('run-a', [0, 0]), sampleFormat: 'f32le' } as AudioChunk);
    expect(capture.snapshot()).toBeNull();

    playback.push(chunk('run-a', [0, 0]));
    expect(capture.snapshot()?.durationSeconds).toBeCloseTo(0.5);

    // A new run starts a new recording rather than appending to the old one.
    playback.push(chunk('run-b', [0, 0]));
    expect(capture.snapshot()?.durationSeconds).toBeCloseTo(0.5);
  });

  it('retains nothing when no capture is supplied', () => {
    const context = new FakeContext();
    const playback = new PcmPlayback(context as unknown as AudioContext);
    expect(() => playback.push(chunk('run-a', [0, 0]))).not.toThrow();
    expect(context.sources).toHaveLength(1);
  });
});
