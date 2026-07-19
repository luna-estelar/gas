import { createInputState } from '@luna-estelar/gas-core';
import type { ConnectorAudioChunk, Renderer, Timeline } from '@luna-estelar/gas-protocol';
import { describe, expect, it } from 'vitest';
import { applyS16leGain, BufferLedger, createRenderer } from '../src/index.js';
import { FakeConnector } from './support/fake-connector.js';
import { testTimeline } from './support/timeline.js';
import { VirtualClock } from './support/virtual-clock.js';

describe('audio delivery', () => {
  it('assigns sequence numbers and applies global s16le gain once', async () => {
    const timeline = testTimeline({ globals: { level: { kind: 'level', value: 0.5 } } });
    const { connector, renderer } = await audioRenderer(timeline);
    const audio: Array<{ sequence: number; samples: number[] }> = [];
    renderer.on('audio', (chunk) =>
      audio.push({ sequence: chunk.sequence, samples: decodeSamples(chunk.bytes) })
    );
    connector.sink!.push(chunk('run-audio', [10_000, -10_000], 2));
    connector.sink!.push(chunk('run-audio', [32_767, -32_768], 2));
    expect(audio).toEqual([
      { sequence: 0, samples: [5_000, -5_000] },
      { sequence: 1, samples: [16_384, -16_384] }
    ]);
  });

  it('paces burst chunks to the committed lookahead window', async () => {
    const timeline = infiniteTimeline();
    const { clock, connector, renderer } = await audioRenderer(timeline);
    const sequences: number[] = [];
    renderer.on('audio', (value) => sequences.push(value.sequence));
    connector.sink!.push(chunk('run-audio', [1], 2));
    connector.sink!.push(chunk('run-audio', [2], 2));
    connector.sink!.push(chunk('run-audio', [3], 2));
    expect(sequences).toEqual([0, 1]);
    clock.advanceTo(2);
    await flushAsync();
    expect(sequences).toEqual([0, 1, 2]);
  });

  it('visibly rejects stale chunks after stop', async () => {
    const { connector, renderer } = await audioRenderer(infiniteTimeline());
    const warnings: string[] = [];
    renderer.on('warning', (warning) => warnings.push(warning.code));
    const sink = connector.sink!;
    await renderer.stop();
    sink.push(chunk('run-audio', [1], 2));
    expect(warnings).toContain('stale-audio-rejected');
  });

  it('surfaces connector stream status and ignores stale callbacks', async () => {
    const { connector, renderer } = await audioRenderer(infiniteTimeline());
    const statuses: Array<{ playback: string; stream?: string; throttled?: boolean }> = [];
    renderer.on('status', (status) =>
      statuses.push({
        playback: status.playback,
        ...(status.stream !== undefined ? { stream: status.stream } : {}),
        ...(status.throttled !== undefined ? { throttled: status.throttled } : {})
      })
    );
    const sink = connector.sink!;

    sink.status('streaming', 'run-audio');
    sink.status('throttled', 'run-audio');
    sink.status('ended', 'run-audio');
    expect(statuses.slice(-3)).toEqual([
      { playback: 'running', stream: 'streaming' },
      { playback: 'running', stream: 'throttled', throttled: true },
      { playback: 'running', stream: 'ended' }
    ]);

    await renderer.stop();
    const afterStop = statuses.length;
    sink.status('streaming', 'run-audio');
    expect(statuses).toHaveLength(afterStop);
  });

  it('warns, throttles at the hard limit, and resumes below the warning level', async () => {
    const { clock, connector, renderer } = await audioRenderer(infiniteTimeline());
    const warnings: string[] = [];
    const throttled: boolean[] = [];
    renderer.on('warning', (warning) => warnings.push(warning.code));
    renderer.on('status', (status) => throttled.push(status.throttled ?? false));
    pushBurst(connector, 17);
    await flushAsync();
    expect(warnings.filter((code) => code === 'audio-buffer-high')).toHaveLength(1);
    expect(connector.calls).toContain('paused:true');
    expect(throttled).toContain(true);

    connector.sink!.status('streaming', 'run-audio');
    expect(throttled.at(-1)).toBe(true);

    clock.advanceTo(20);
    await flushAsync();
    expect(connector.calls).toContain('paused:false');
  });

  it('fails clearly at the hard limit when flow control is unavailable', async () => {
    const connector = new FakeConnector({ description: { supportsFlowControl: false } });
    const { renderer } = await audioRenderer(infiniteTimeline(), connector);
    const failures: string[] = [];
    renderer.on('failure', (failure) => failures.push(failure.code));
    pushBurst(connector, 17);
    await flushAsync();
    expect(failures).toContain('audio-backpressure-overflow');
  });

  it('fails if generation continues after flow control has throttled the connector', async () => {
    const { connector, renderer } = await audioRenderer(infiniteTimeline());
    const failures: string[] = [];
    renderer.on('failure', (failure) => failures.push(failure.code));
    pushBurst(connector, 17);
    await flushAsync();
    expect(connector.calls).toContain('paused:true');

    connector.sink!.push(chunk('run-audio', [18], 2));
    await flushAsync();
    expect(failures).toContain('audio-backpressure-overflow');
  });
});

describe('audio accounting and gain primitives', () => {
  it('balances received audio across delivered, rejected, and held', () => {
    const ledger = new BufferLedger();
    ledger.receive(6);
    ledger.deliver(2);
    ledger.reject(1);
    const snapshot = ledger.snapshot();
    expect(snapshot).toEqual({
      receivedSeconds: 6,
      deliveredSeconds: 2,
      rejectedSeconds: 1,
      heldSeconds: 3
    });
    expect(snapshot.receivedSeconds).toBe(
      snapshot.deliveredSeconds + snapshot.rejectedSeconds + snapshot.heldSeconds
    );
  });

  it('handles silence, unity, and attenuation sample math', () => {
    const bytes = encodeSamples([32_767, -32_768, 1_001, -1_001]);
    expect(decodeSamples(applyS16leGain(bytes, 0))).toEqual([0, 0, 0, 0]);
    expect(decodeSamples(applyS16leGain(bytes, 1))).toEqual([32_767, -32_768, 1_001, -1_001]);
    expect(decodeSamples(applyS16leGain(bytes, 0.5))).toEqual([16_384, -16_384, 501, -500]);
    expect(decodeSamples(applyS16leGain(bytes, 2))).toEqual([32_767, -32_768, 1_001, -1_001]);
    expect(decodeSamples(applyS16leGain(bytes, -1))).toEqual([0, 0, 0, 0]);
  });
});

async function audioRenderer(
  timeline: Timeline,
  connector = new FakeConnector()
): Promise<{ clock: VirtualClock; connector: FakeConnector; renderer: Renderer }> {
  const clock = new VirtualClock();
  const renderer = await createRenderer({
    clock,
    connector,
    runIdFactory: () => 'run-audio'
  });
  await renderer.load(timeline, createInputState(timeline));
  await renderer.start();
  return { clock, connector, renderer };
}

function infiniteTimeline(): Timeline {
  return testTimeline({ playback: { mode: 'infinite' } });
}

function pushBurst(connector: FakeConnector, count: number): void {
  for (let index = 0; index < count; index += 1) {
    connector.sink!.push(chunk('run-audio', [index], 2));
  }
}

function chunk(
  runId: string,
  samples: readonly number[],
  durationSeconds: number
): ConnectorAudioChunk {
  return {
    runId,
    bytes: encodeSamples(samples),
    durationSeconds,
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: 48_000,
    channels: 2
  };
}

function encodeSamples(samples: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return bytes;
}

function decodeSamples(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples: number[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    samples.push(view.getInt16(offset, true));
  }
  return samples;
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
