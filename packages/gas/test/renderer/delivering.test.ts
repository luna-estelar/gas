import { describe, expect, it } from 'vitest';
import { applyS16leGain, BufferLedger } from '../../src/renderer/index.js';
import { flushAsync } from '../../../../test/support/deferred.js';
import { testTimeline } from '../../../../test/support/timeline.js';
import {
  decodeSamples,
  encodeSamples,
  playing,
  rig,
  samplesChunk,
  type Rig
} from './support/rig.js';
import type { FakeConnection } from '../../../../test/support/fake-connection.js';

const infinite = () => testTimeline({ playback: { mode: 'infinite' } });

describe('audio delivery', () => {
  it('holds audio sent while connecting and releases it from the anchor', async () => {
    const r = rig(infinite());
    r.connector.autoConnect = false;
    const sequences = sequencesOf(r);

    const play = r.renderer.play();
    await flushAsync();
    r.clock.advanceTo(10);
    const connection = r.connector.resolveConnect();
    connection.pushAudio(6);
    expect(sequences).toEqual([]);

    await play;
    expect(sequences).toEqual([0, 1]);
    r.clock.advanceTo(11.99);
    expect(sequences).toEqual([0, 1]);
    r.clock.advanceTo(12);
    expect(sequences).toEqual([0, 1, 2]);
  });

  it('drops audio sent while connecting when playback stops first', async () => {
    const r = rig(infinite());
    r.connector.autoConnect = false;

    const play = r.renderer.play();
    await flushAsync();
    const connection = r.connector.resolveConnect();
    connection.pushAudio(2);
    r.renderer.stop();
    await expect(play).rejects.toMatchObject({ code: 'cancelled' });
    await flushAsync();

    expect(r.audio).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(connection.calls.filter((call) => call === 'close')).toHaveLength(1);
    expect(r.clock.pendingDeadlines()).toEqual([]);
  });

  it('assigns sequence numbers and applies global s16le gain once', async () => {
    const timeline = testTimeline({ globals: { level: { kind: 'level', value: 0.5 } } });
    const { connection, renderer } = await playing(timeline, { firstAudio: 0 });
    const audio: Array<{ sequence: number; samples: number[] }> = [];
    renderer.on('audio', (chunk) =>
      audio.push({ sequence: chunk.sequence, samples: decodeSamples(chunk.bytes) })
    );
    connection.options.onAudio(samplesChunk([10_000, -10_000], 2));
    connection.options.onAudio(samplesChunk([32_767, -32_768], 2));
    expect(audio).toEqual([
      { sequence: 0, samples: [5_000, -5_000] },
      { sequence: 1, samples: [16_384, -16_384] }
    ]);
  });

  it('paces burst chunks to the anchored lookahead window', async () => {
    const r = await playing(infinite(), { firstAudio: 0 });
    const sequences = sequencesOf(r);
    r.connection.pushAudio(6);
    expect(sequences).toEqual([0, 1]);
    r.clock.advanceTo(2);
    await flushAsync();
    expect(sequences).toEqual([0, 1, 2]);
  });

  it('drops chunks sent after stop, without a warning (rule 1)', async () => {
    const { connection, renderer, audio, warnings } = await playing(infinite());
    const before = audio.length;
    renderer.stop();
    connection.pushAudio(2);
    expect(audio).toHaveLength(before);
    expect(warnings).toEqual([]);
  });

  it('passes connection warnings on with safe text and ignores them after stop', async () => {
    const secret = 'provider-warning-secret';
    const { connection, renderer, warnings } = await playing(infinite());

    connection.warn({ code: 'tempo-clamped', message: secret });
    expect(warnings).toEqual([
      { code: 'tempo-clamped', message: 'The connector reported a warning.' }
    ]);

    renderer.stop();
    connection.warn({ code: 'late', message: 'late' });
    expect(warnings).toHaveLength(1);
  });

  it('warns, pauses the model at the hard limit, and resumes below the warning level', async () => {
    const { clock, connection, warnings } = await playing(infinite(), { firstAudio: 0 });
    pushBurst(connection, 17);
    await flushAsync();
    expect(codes(warnings, 'audio-buffer-high')).toHaveLength(1);
    expect(codes(warnings, 'generation-paused-backlog')).toHaveLength(1);
    expect(connection.flow).toEqual(['pause']);

    clock.advanceTo(20);
    await flushAsync();
    expect(connection.flow).toEqual(['pause', 'resume']);
  });

  it('fails only if generation runs on to the overflow limit while paused', async () => {
    const { connection, ends } = await playing(infinite(), { firstAudio: 0 });
    pushBurst(connection, 17);
    await flushAsync();
    expect(connection.flow).toEqual(['pause']);

    // Below the overflow limit a backlog only pauses the model.
    pushBurst(connection, 14);
    await flushAsync();
    expect(ends).toEqual([]);

    pushBurst(connection, 1);
    await flushAsync();
    expect(ends).toEqual([
      {
        reason: 'failed',
        failure: expect.objectContaining({ code: 'audio-backpressure-overflow' })
      }
    ]);
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

function sequencesOf(r: Rig): number[] {
  const sequences: number[] = [];
  r.renderer.on('audio', (value) => sequences.push(value.sequence));
  return sequences;
}

function codes(warnings: ReadonlyArray<{ code: string }>, code: string): unknown[] {
  return warnings.filter((warning) => warning.code === code);
}

/** `count` two-second chunks, one at a time, each with its own sample value. */
function pushBurst(connection: FakeConnection, count: number): void {
  for (let index = 0; index < count; index += 1) {
    connection.options.onAudio(samplesChunk([index], 2));
  }
}
