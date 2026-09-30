// Musical time starts with the first audible sample, not when the connector says
// it is ready. A connector whose start resolves at session setup — Lyria's does —
// would otherwise begin the musical clock before any audio exists, leaving every
// chunk that much closer to being late.

import { applyCommand, createInputState } from '@luna-estelar/gas-core';
import type {
  AudioChunk,
  ConnectorAudioChunk,
  InputState,
  RendererFailure,
  RendererPositionEvent,
  RendererStatusEvent,
  Timeline
} from '@luna-estelar/gas-protocol';
import { describe, expect, it } from 'vitest';
import { createRenderer } from '../src/index.js';
import { FakeConnector, anchorChunk } from './support/fake-connector.js';
import { testTimeline } from './support/timeline.js';
import { VirtualClock } from './support/virtual-clock.js';

describe('renderer anchoring', () => {
  it('anchors bar one to the arrival of the first chunk', async () => {
    const { clock, connector, renderer, positions, statuses, audio } = await startedRenderer(
      testTimeline({ playback: { mode: 'infinite' } })
    );

    // start() has resolved, but nothing is audible yet, so nothing has started.
    expect(statuses.map((status) => status.playback)).toEqual(['starting']);
    expect(positions).toEqual([]);

    clock.advanceTo(1.3);
    connector.sink!.push(chunk('run-1', 2));

    expect(statuses.map((status) => status.playback)).toEqual(['starting', 'running']);
    // Bar one is now, so the run is zero seconds old however long startup took.
    expect(positions).toEqual([
      { runId: 'run-1', position: { bar: 1 }, seconds: 0, loopIteration: 1 }
    ]);
    expect(audio.map((value) => value.sequence)).toEqual([0]);
    expect(renderer.positionAtSeconds?.(0)).toEqual({ bar: 1 });
    // Two seconds per bar at 120 BPM 4/4.
    expect(renderer.positionAtSeconds?.(2)).toEqual({ bar: 2 });
    expect(renderer.positionAtSeconds?.(1)).toEqual({ bar: 1, beat: { index: 3 } });
  });

  it('paces the chunks after the first from the anchor, not from startup', async () => {
    const { clock, connector, audio } = await startedRenderer(
      testTimeline({ playback: { mode: 'infinite' } })
    );
    clock.advanceTo(1.3);
    connector.sink!.push(chunk('run-1', 2));
    connector.sink!.push(chunk('run-1', 2));
    connector.sink!.push(chunk('run-1', 2));

    // Chunk zero starts at the anchor; chunk one is due at 3.3 and released a
    // lookahead of one chunk ahead of that, so immediately. Chunk two waits.
    expect(audio.map((value) => value.sequence)).toEqual([0, 1]);
    clock.advanceTo(3.29);
    expect(audio).toHaveLength(2);
    clock.advanceTo(3.3);
    expect(audio.map((value) => value.sequence)).toEqual([0, 1, 2]);
  });

  it('anchors once, when startup settles, for audio pushed from inside start()', async () => {
    // A connector may push before its own start() resolves. Anchoring at that
    // arrival would credit musical time nobody heard, since nothing is delivered
    // before the anchor exists; anchoring when startup settles keeps the two
    // clocks together.
    const clock = new VirtualClock();
    const gate = deferred();
    const connector = new FakeConnector({
      startGate: gate.promise,
      startChunks: [chunk('run-1', 2)]
    });
    const renderer = await createRenderer({ clock, connector, runIdFactory: () => 'run-1' });
    const timeline = testTimeline({ playback: { mode: 'infinite' } });
    await renderer.load(timeline, createInputState(timeline));
    const positions: RendererPositionEvent[] = [];
    const audio: AudioChunk[] = [];
    renderer.on('position', (event) => positions.push(event));
    renderer.on('audio', (value) => audio.push(value));

    const starting = renderer.start();
    await flushAsync();
    clock.advanceTo(0.4);
    expect(audio).toEqual([]);

    clock.advanceTo(0.9);
    gate.resolve();
    await starting;

    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ position: { bar: 1 }, seconds: 0 });
    expect(audio).toHaveLength(1);
    expect(renderer.positionAtSeconds?.(0)).toEqual({ bar: 1 });
  });

  it('fails the run when a connected connector stays silent', async () => {
    const { clock, renderer, failures, statuses } = await startedRenderer(
      testTimeline({ playback: { mode: 'infinite' } }),
      { firstAudioTimeoutSeconds: 4 }
    );

    clock.advanceTo(3.99);
    await flushAsync();
    expect(failures).toEqual([]);

    clock.advanceTo(4);
    await flushAsync();
    expect(failures).toEqual([
      {
        code: 'generation-failed',
        message: 'The connector produced no audio before the renderer timeout.',
        reason: 'provider',
        runId: 'run-1',
        retryable: true
      }
    ]);
    expect(statuses.at(-1)?.playback).toBe('failed');
    expect(clock.pendingDeadlines()).toEqual([]);
    expect(renderer.positionAtSeconds?.(0)).toBeUndefined();
  });

  it('defaults the silence timeout to three chunk durations, clamped', async () => {
    // The fake connector advertises two-second chunks, so the default is six.
    const { clock, failures } = await startedRenderer(
      testTimeline({ playback: { mode: 'infinite' } })
    );
    clock.advanceTo(5.99);
    await flushAsync();
    expect(failures).toEqual([]);
    clock.advanceTo(6);
    await flushAsync();
    expect(failures).toHaveLength(1);
  });

  it('cancels the silence timeout once audio arrives', async () => {
    const { clock, connector, failures } = await startedRenderer(
      testTimeline({ playback: { mode: 'infinite' } }),
      { firstAudioTimeoutSeconds: 4 }
    );
    clock.advanceTo(1);
    connector.sink!.push(chunk('run-1', 2));
    clock.advanceTo(20);
    await flushAsync();
    expect(failures).toEqual([]);
  });

  it('anchors at connector start when a host asks for the old timing', async () => {
    const clock = new VirtualClock();
    const gate = deferred();
    const connector = new FakeConnector({ startGate: gate.promise });
    const renderer = await createRenderer({
      clock,
      connector,
      runIdFactory: () => 'run-1',
      anchor: 'connector-start'
    });
    const timeline = testTimeline({ playback: { mode: 'infinite' } });
    await renderer.load(timeline, createInputState(timeline));
    const positions: RendererPositionEvent[] = [];
    renderer.on('position', (event) => positions.push(event));

    const starting = renderer.start();
    await flushAsync();
    clock.advanceTo(10);
    gate.resolve();
    await starting;

    // Musical time starts with no audio in hand, and no silence timeout is armed.
    expect(positions).toEqual([
      { runId: 'run-1', position: { bar: 1 }, seconds: 0, loopIteration: 1 }
    ]);
    clock.advanceTo(40);
    await flushAsync();
    expect(renderer.positionAtSeconds?.(0)).toEqual({ bar: 1 });
  });

  it('accepts a state change made before the first chunk arrives', async () => {
    // play() resolves before audio exists, so a host that reaches for a fader in
    // that moment must be answered rather than told the renderer is busy.
    const timeline = testTimeline({ playback: { mode: 'infinite' } });
    const { clock, connector, renderer, positions } = await startedRenderer(timeline);

    const state = applyActive(createInputState(timeline), { kind: 'setTempo', bpm: 60 });
    const result = await renderer.updateState(state);
    expect(result).toEqual({ requestedPosition: { bar: 1 }, appliedPosition: { bar: 1 } });
    expect(connector.updates.at(-1)?.update.state.globals.tempo).toBe(60);

    // The tempo set before the anchor is the tempo the anchored run plays at:
    // four seconds a bar, so bar two is four seconds after first audio.
    clock.advanceTo(1);
    connector.sink!.push(chunk('run-1', 2));
    expect(positions).toHaveLength(1);
    expect(renderer.positionAtSeconds?.(4)).toEqual({ bar: 2 });
  });

  it('keeps no playhead before the anchor or after the run', async () => {
    const timeline = testTimeline({ playback: { mode: 'infinite' } });
    const { connector, renderer } = await startedRenderer(timeline);
    expect(renderer.positionAtSeconds?.(1)).toBeUndefined();

    connector.sink!.push(chunk('run-1', 2));
    expect(renderer.positionAtSeconds?.(1)).toEqual({ bar: 1, beat: { index: 3 } });
    expect(renderer.positionAtSeconds?.(Number.NaN)).toBeUndefined();

    await renderer.stop();
    expect(renderer.positionAtSeconds?.(1)).toBeUndefined();
  });

  it('rejects audio that arrives after a finite run has completed', async () => {
    // The run ends before the connector is asked to stop, so a chunk generated
    // during that round trip is not accepted into a run that is over.
    const clock = new VirtualClock();
    const connector = new FakeConnector({ anchorOnStart: true });
    const renderer = await createRenderer({ clock, connector, runIdFactory: () => 'run-1' });
    const timeline = testTimeline();
    await renderer.load(timeline, createInputState(timeline));
    const warnings: string[] = [];
    renderer.on('warning', (warning) => warnings.push(warning.code));
    await renderer.start();

    clock.advanceTo(8);
    await flushAsync();
    connector.sink!.push(chunk('run-1', 2));
    expect(warnings).toContain('stale-audio-rejected');
  });
});

async function startedRenderer(
  timeline: Timeline,
  options: { readonly firstAudioTimeoutSeconds?: number } = {}
): Promise<{
  clock: VirtualClock;
  connector: FakeConnector;
  renderer: Awaited<ReturnType<typeof createRenderer>>;
  positions: RendererPositionEvent[];
  statuses: RendererStatusEvent[];
  audio: AudioChunk[];
  failures: RendererFailure[];
}> {
  const clock = new VirtualClock();
  const connector = new FakeConnector();
  const renderer = await createRenderer({
    clock,
    connector,
    runIdFactory: () => 'run-1',
    ...options
  });
  await renderer.load(timeline, createInputState(timeline));
  const positions: RendererPositionEvent[] = [];
  const statuses: RendererStatusEvent[] = [];
  const audio: AudioChunk[] = [];
  const failures: RendererFailure[] = [];
  renderer.on('position', (event) => positions.push(event));
  renderer.on('status', (event) => statuses.push(event));
  renderer.on('audio', (value) => audio.push(value));
  renderer.on('failure', (failure) => failures.push(failure));
  await renderer.start();
  return { clock, connector, renderer, positions, statuses, audio, failures };
}

function chunk(runId: string, durationSeconds: number): ConnectorAudioChunk {
  return { ...anchorChunk(runId), durationSeconds };
}

function applyActive(state: InputState, command: Parameters<typeof applyCommand>[1]): InputState {
  const result = applyCommand(state, command, {
    phase: 'active',
    capabilities: {
      intents: {
        flavor: 'supported',
        key: 'supported',
        tempo: 'supported',
        time_signature: 'supported',
        timbre: 'supported',
        level: 'supported',
        notes: 'unsupported',
        motif: 'unsupported'
      }
    }
  });
  if (!result.ok) throw new Error(result.failure.message);
  return result.state;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = () => settle();
  });
  return { promise, resolve };
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
