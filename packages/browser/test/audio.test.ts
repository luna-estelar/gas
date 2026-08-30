import { describe, expect, it } from 'vitest';
import type { AudioChunk } from '@luna-estelar/gas-protocol';
import { PcmCapture, decodeS16lePcm, encodeWave } from '../src/audio.js';
import { accessSettings, createCredentialCell } from '../src/access.js';
import { buildMergePatch } from '../src/config.js';

function chunk(sequence = 0, runId = 'run-1'): AudioChunk {
  return {
    runId,
    sequence,
    bytes: new Uint8Array([0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f, 0x00, 0x00]),
    durationSeconds: 0.2,
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: 10,
    channels: 2
  };
}

describe('PCM decoding and capture', () => {
  it('decodes interleaved signed-16 PCM into planar float channels', () => {
    const decoded = decodeS16lePcm(chunk());
    expect(decoded.frames).toBe(2);
    expect(decoded.durationSeconds).toBe(0.2);
    expect([...decoded.channels[0]!]).toEqual([0.5, 32767 / 32768]);
    expect([...decoded.channels[1]!]).toEqual([-0.5, 0]);
  });

  it('rejects audio that is not frame-aligned signed-16 PCM', () => {
    expect(() => decodeS16lePcm({ ...chunk(), sampleFormat: 'f32le' } as AudioChunk)).toThrow(
      'signed 16-bit PCM'
    );
    expect(() => decodeS16lePcm({ ...chunk(), channels: 3 })).toThrow('complete PCM frames');
    expect(() => decodeS16lePcm({ ...chunk(), sampleRate: 0 })).toThrow('invalid sample rate');
  });

  it('writes a canonical PCM WAV and resets per-run capture', () => {
    const capture = new PcmCapture();
    capture.append(chunk());
    const snapshot = capture.snapshot()!;
    expect(new TextDecoder().decode(snapshot.bytes.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(snapshot.bytes.slice(8, 12))).toBe('WAVE');
    expect(new DataView(snapshot.bytes.buffer).getUint32(40, true)).toBe(8);
    expect(snapshot.durationSeconds).toBe(0.2);
    capture.reset();
    expect(capture.snapshot()).toBeNull();
    expect(() => encodeWave([])).toThrow('No audio');
  });

  it('refuses to concatenate chunks that do not share one PCM format', () => {
    expect(() => encodeWave([chunk(), { ...chunk(1), sampleRate: 20 }])).toThrow(
      'do not share one PCM format'
    );
  });

  it('copies chunk bytes on capture so later reuse cannot corrupt the recording', () => {
    const source = chunk();
    const capture = new PcmCapture();
    capture.append(source);
    source.bytes.fill(0);
    const snapshot = capture.snapshot()!;
    expect(new DataView(snapshot.bytes.buffer).getInt16(44, true)).toBe(0x4000);
  });
});

describe('access and credentials', () => {
  it('clears credentials without exposing the stored value', () => {
    const cell = createCredentialCell('secret-value');
    expect(cell.read()).toBe('secret-value');
    expect(JSON.stringify(cell)).not.toContain('secret-value');
    cell.clear();
    expect(cell.cleared).toBe(true);
    expect(() => cell.read()).toThrow('cleared');
  });

  it('produces connector settings for both access modes', () => {
    expect(accessSettings({ mode: 'byok', credentials: createCredentialCell('k') })).toEqual({
      accessMode: 'byok',
      apiKey: 'k'
    });
    expect(accessSettings({ mode: 'hosted', proxyBaseUrl: 'https://proxy.example' })).toEqual({
      accessMode: 'hosted',
      proxyBaseUrl: 'https://proxy.example'
    });
  });
});

describe('connector config patches', () => {
  it('builds recursive merge patches and nulls removed optional fields', () => {
    expect(
      buildMergePatch(
        { prompt: { strategy: 'per-track' }, generation: { seed: 42, topK: 40 } },
        { prompt: { strategy: 'global-plus-tracks' }, generation: { topK: 80 } }
      )
    ).toEqual({
      prompt: { strategy: 'global-plus-tracks' },
      generation: { seed: null, topK: 80 }
    });
  });

  it('omits branches that did not change', () => {
    expect(
      buildMergePatch(
        { prompt: { strategy: 'per-track' }, generation: { topK: 40 } },
        { prompt: { strategy: 'per-track' }, generation: { topK: 40 } }
      )
    ).toEqual({});
  });
});
