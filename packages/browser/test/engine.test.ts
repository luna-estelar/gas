// The buffer-source engine against a scripted device clock. Unless a case says
// otherwise: 2 s chunks, a 2 s prebuffer and a 48 kHz context, which is Lyria's
// shape and the one LE-89 dropped out on.
import { describe, expect, it } from 'vitest';
import type { AudioStatus, AudioWarning } from '../src/audio/engine.js';
import { ChainedSourceEngine } from '../src/audio/chained-source-engine.js';
import { PcmCapture } from '../src/capture.js';
import { FakeAudioContext, pcmChunk } from './support/fake-audio-context.js';

function setup(options: { sampleRate?: number; prebufferSeconds?: number } = {}) {
  const context = new FakeAudioContext(options.sampleRate ?? 48_000);
  const capture = new PcmCapture();
  const engine = new ChainedSourceEngine(context.asContext(), {
    prebufferSeconds: options.prebufferSeconds ?? 2,
    clock: context.clock,
    capture
  });
  const states: AudioStatus['state'][] = [];
  const warnings: AudioWarning[] = [];
  engine.on('status', (status) => states.push(status.state));
  engine.on('warning', (warning) => warnings.push(warning));
  /** Move the device clock to `time`, then deliver `chunk` there. */
  const at = (time: number, chunk: Parameters<typeof engine.push>[0]) => {
    context.advanceTo(time);
    engine.push(chunk);
  };
  return { context, engine, capture, states, warnings, at };
}

const starts = (context: FakeAudioContext) => context.started.map((source) => source.startedAt!);

describe('prebuffering', () => {
  it('holds the first chunk for the prebuffer, then plays the chain contiguously', () => {
    const { context, engine, at } = setup();
    at(0, pcmChunk(0));
    context.advanceTo(1.99);
    expect(context.started).toEqual([]);
    expect(engine.status().state).toBe('buffering');

    at(2.0, pcmChunk(1));
    expect(starts(context)).toHaveLength(2);
    expect(starts(context)[0]).toBeCloseTo(2.05, 9);
    expect(starts(context)[1]).toBeCloseTo(4.05, 9);
    expect(engine.status().state).toBe('playing');
  });

  it('starts at once when a fast connector already delivered a prebuffer beyond chunk 0', () => {
    const { context, at } = setup();
    at(0.1, pcmChunk(0));
    at(0.1, pcmChunk(1));
    expect(starts(context)[0]).toBeCloseTo(0.15, 9);
    expect(starts(context)[1]).toBeCloseTo(2.15, 9);
  });

  it('absorbs a chunk up to a prebuffer late without a gap', () => {
    const { context, engine, at } = setup();
    at(0, pcmChunk(0));
    at(2.0, pcmChunk(1));
    at(4.4, pcmChunk(2));
    expect(starts(context)[2]).toBeCloseTo(6.05, 9);
    expect(engine.status().underruns).toBe(0);
  });
});

describe('underruns', () => {
  it('rebuffers from the late chunk, counts it, and continues the chain', () => {
    const { context, engine, states, at } = setup();
    at(0, pcmChunk(0));
    at(2.0, pcmChunk(1));
    states.length = 0;

    // Chunk 1 ended at 6.05; chunk 2 is 250 ms past that.
    at(6.3, pcmChunk(2));
    expect(engine.status().underruns).toBe(1);
    expect(states).toEqual(['stopped', 'underrun', 'buffering']);
    expect(context.started).toHaveLength(2);

    context.advanceTo(8.3);
    expect(states.at(-1)).toBe('playing');
    expect(starts(context)[2]).toBeCloseTo(8.35, 9);
    at(8.5, pcmChunk(3));
    expect(starts(context)[3]).toBeCloseTo(10.35, 9);
  });

  // The same rule as the first start: a burst that already covers the prebuffer
  // beyond the late chunk is margin in hand, so it does not wait out the timer.
  it('resumes early when a burst after the underrun covers the prebuffer', () => {
    const { context, at } = setup();
    at(0, pcmChunk(0));
    at(2.0, pcmChunk(1));
    at(6.3, pcmChunk(2));
    at(6.5, pcmChunk(3));
    expect(starts(context)[2]).toBeCloseTo(6.55, 9);
    expect(starts(context)[3]).toBeCloseTo(8.55, 9);
  });
});

describe('frame accounting', () => {
  it('chains 48 kHz chunks on a 44.1 kHz context without drift', () => {
    const { context, at } = setup({ sampleRate: 44_100 });
    for (let sequence = 0; sequence < 100; sequence++) at(0, pcmChunk(sequence));
    const frames = starts(context).map((when) => Math.round(when * 44_100));
    expect(frames).toHaveLength(100);
    const step = Math.round((96_000 * 44_100) / 48_000);
    frames.forEach((frame, index) => expect(frame - frames[0]!).toBe(index * step));
    // Buffers keep the chunk's own rate; the graph resamples.
    expect(context.buffers.every((buffer) => buffer.sampleRate === 48_000)).toBe(true);
  });

  // 128 frames at 48 kHz is 117.6 frames at 44.1 kHz. Rounding each chunk to
  // 118 would put the 1000th start about 9 ms late.
  it('carries fractional output frames across chunks instead of rounding each one', () => {
    const { context, at } = setup({ sampleRate: 44_100, prebufferSeconds: 0.25 });
    const seconds = 128 / 48_000;
    for (let sequence = 0; sequence < 1000; sequence++) at(0, pcmChunk(sequence, { seconds }));
    const when = starts(context);
    expect(when).toHaveLength(1000);
    expect(when[999]! - when[0]!).toBeCloseTo(999 * seconds, 9);
  });

  it('keeps the start time of the last 64 chunks', () => {
    const { engine, at } = setup();
    for (let sequence = 0; sequence < 70; sequence++) at(0, pcmChunk(sequence));
    expect(engine.startTimeOf(5)).toBeUndefined();
    expect(engine.startTimeOf(6)).toBeCloseTo(0.05 + 12, 9);
    expect(engine.startTimeOf(69)).toBeCloseTo(0.05 + 69 * 2, 9);
  });
});

describe('rejected chunks', () => {
  it('drops a chunk whose format differs from the run and warns', () => {
    const { context, engine, warnings, at } = setup();
    at(0, pcmChunk(0));
    const before = engine.status();
    at(0.5, pcmChunk(1, { sampleRate: 44_100 }));
    expect(warnings).toEqual([{ code: 'format-mismatch', sequence: 1 }]);
    expect(context.buffers).toHaveLength(1);
    expect(engine.status().state).toBe(before.state);
  });

  it('drops a chunk that is not whole PCM frames and warns', () => {
    const { context, warnings, at } = setup();
    at(0, { ...pcmChunk(0), bytes: new Uint8Array(3) });
    expect(warnings).toEqual([{ code: 'chunk-rejected', sequence: 0 }]);
    expect(context.buffers).toEqual([]);
  });

  it('warns once per run while the context is suspended', () => {
    const { context, warnings, at } = setup();
    context.state = 'suspended';
    at(0, pcmChunk(0));
    at(0, pcmChunk(1));
    expect(warnings).toEqual([{ code: 'context-suspended', sequence: 0 }]);
  });
});

describe('gain, flush and run changes', () => {
  it('flush ramps to silence over 20 ms and stops every source at the end of the ramp', () => {
    const { context, engine, at } = setup();
    at(0.1, pcmChunk(0));
    at(0.1, pcmChunk(1));
    context.advanceTo(1);
    engine.flush();
    expect(context.master.gain.calls.slice(-2)).toEqual([
      ['set', 1, 1],
      ['ramp', 0, 1.02]
    ]);
    expect(context.started.map((source) => source.stoppedAt)).toEqual([1.02, 1.02]);
    expect(engine.status().state).toBe('stopped');
    expect(engine.playheadSeconds()).toBeUndefined();
  });

  it('stops before anything plays when flushed mid-buffer', () => {
    const { context, engine, at } = setup();
    at(0, pcmChunk(0, { seconds: 1 }));
    at(0.5, pcmChunk(1, { seconds: 1 }));
    engine.flush();
    context.advanceTo(5);
    expect(context.started).toEqual([]);
    expect(context.master.gain.value).toBe(0);
    expect(engine.status().state).toBe('stopped');
  });

  it('flushes the old run on a new run id and brings the gain back at the new start', () => {
    const { context, engine, capture, at } = setup();
    at(0.1, pcmChunk(0));
    at(0.1, pcmChunk(1));
    at(1, pcmChunk(0, { runId: 'run-b' }));
    expect(context.started.map((source) => source.stoppedAt)).toEqual([1.02, 1.02]);
    expect(engine.status().state).toBe('buffering');
    expect(capture.snapshot()?.durationSeconds).toBe(2);

    context.advanceTo(3);
    const runB = context.started[2]!;
    expect(runB.startedAt).toBeCloseTo(3.05, 9);
    expect(context.master.gain.calls.slice(-2)).toEqual([
      ['cancel', runB.startedAt],
      ['set', 1, runB.startedAt]
    ]);
  });

  it('plays a finished run out and reaches stopped when its last source ends', () => {
    const { context, engine, at } = setup();
    at(0.1, pcmChunk(0));
    at(0.1, pcmChunk(1));
    context.advanceTo(4.14);
    expect(engine.status().state).toBe('playing');
    context.advanceTo(4.2);
    expect(engine.status().state).toBe('stopped');
    expect(context.started.every((source) => source.stoppedAt === undefined)).toBe(true);
  });

  it('closes without closing the context', async () => {
    const { context, engine, at } = setup();
    at(0.1, pcmChunk(0));
    at(0.1, pcmChunk(1));
    await engine.close();
    expect(context.closes).toBe(0);
    expect(context.master.disconnected).toBe(1);
    expect(context.started.every((source) => source.stoppedAt !== undefined)).toBe(true);
    engine.push(pcmChunk(2));
    expect(context.buffers).toHaveLength(2);
  });
});

describe('playhead', () => {
  it('reports audible seconds from scheduled playback and freezes while rebuffering', () => {
    const { context, engine, at } = setup();
    context.outputLatency = 0.1;
    at(0, pcmChunk(0));
    expect(engine.playheadSeconds()).toBeUndefined();

    at(2.0, pcmChunk(1));
    // Chunk 0 started at 2.05 and reaches the listener 0.1 s later.
    context.advanceTo(2.05 + 0.1 + 1.0);
    expect(engine.playheadSeconds()).toBeCloseTo(1.0, 9);

    at(6.3, pcmChunk(2));
    expect(engine.playheadSeconds()).toBeCloseTo(4.0, 9);
    context.advanceTo(8.0);
    expect(engine.playheadSeconds()).toBeCloseTo(4.0, 9);

    // Resumed at 8.35; the 2.3 s of inserted silence is not music.
    context.advanceTo(8.35 + 0.1 + 0.5);
    expect(engine.playheadSeconds()).toBeCloseTo(4.5, 9);
    context.advanceTo(20);
    expect(engine.playheadSeconds()).toBeCloseTo(6.0, 9);
  });

  // Resuming subtracts the start lead and the output latency from the new
  // segment; without a clamp the playhead stepped from 4.0 back to 3.85.
  it('never moves backwards across an underrun', () => {
    const { context, engine, at } = setup();
    context.outputLatency = 0.1;
    at(0, pcmChunk(0));
    at(2.0, pcmChunk(1));
    at(6.3, pcmChunk(2));
    let last = -Infinity;
    for (let time = 6.3; time <= 12; time += 0.01) {
      context.advanceTo(time);
      const seconds = engine.playheadSeconds()!;
      expect(seconds).toBeGreaterThanOrEqual(last);
      last = seconds;
    }
    expect(last).toBeCloseTo(6.0, 9);
  });

  // A burst resumes before the old segment has finished reaching the listener,
  // so the playhead keeps following the old audio until it runs out.
  it('finishes the old segment through the output latency after an early resume', () => {
    const { context, engine, at } = setup();
    context.outputLatency = 0.3;
    at(0, pcmChunk(0));
    at(2.0, pcmChunk(1));
    // Chunk 1 ends at 6.05 and is heard until 6.35; the resume starts at 6.15.
    at(6.1, pcmChunk(2));
    at(6.1, pcmChunk(3));
    expect(starts(context)[2]).toBeCloseTo(6.15, 9);
    context.advanceTo(6.2);
    expect(engine.playheadSeconds()).toBeCloseTo(3.85, 9);
    context.advanceTo(6.5);
    expect(engine.playheadSeconds()).toBeCloseTo(4.05, 9);
  });
});
