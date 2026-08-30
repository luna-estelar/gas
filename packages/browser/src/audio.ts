// PCM decoding and WAV encoding for captured renderer audio. Pure byte work: no
// AudioContext, no DOM. Scheduling and playback live in ./playback.ts.
import type { AudioChunk } from '@luna-estelar/gas-protocol';

export interface DecodedPcm {
  readonly channels: readonly Float32Array[];
  readonly frames: number;
  readonly sampleRate: number;
  readonly durationSeconds: number;
}

export function decodeS16lePcm(chunk: AudioChunk): DecodedPcm {
  if (chunk.codec !== 'pcm' || chunk.sampleFormat !== 's16le') {
    throw new Error('Only signed 16-bit PCM audio is supported.');
  }
  if (!Number.isInteger(chunk.channels) || chunk.channels < 1 || chunk.channels > 8) {
    throw new Error('The audio chunk has an unsupported channel count.');
  }
  if (!Number.isFinite(chunk.sampleRate) || chunk.sampleRate <= 0) {
    throw new Error('The audio chunk has an invalid sample rate.');
  }
  const bytesPerFrame = chunk.channels * 2;
  if (chunk.bytes.byteLength === 0 || chunk.bytes.byteLength % bytesPerFrame !== 0) {
    throw new Error('The audio chunk is not aligned to complete PCM frames.');
  }
  const frames = chunk.bytes.byteLength / bytesPerFrame;
  const channels = Array.from({ length: chunk.channels }, () => new Float32Array(frames));
  const view = new DataView(chunk.bytes.buffer, chunk.bytes.byteOffset, chunk.bytes.byteLength);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < chunk.channels; channel++) {
      channels[channel]![frame] =
        view.getInt16((frame * chunk.channels + channel) * 2, true) / 32768;
    }
  }
  return {
    channels,
    frames,
    sampleRate: chunk.sampleRate,
    durationSeconds: frames / chunk.sampleRate
  };
}

export function encodeWave(chunks: readonly AudioChunk[]): Uint8Array {
  if (chunks.length === 0) throw new Error('No audio has been captured yet.');
  const first = chunks[0]!;
  for (const chunk of chunks) {
    if (
      chunk.codec !== 'pcm' ||
      chunk.sampleFormat !== 's16le' ||
      chunk.sampleRate !== first.sampleRate ||
      chunk.channels !== first.channels
    ) {
      throw new Error('Captured chunks do not share one PCM format.');
    }
  }
  const dataLength = chunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0);
  const output = new Uint8Array(44 + dataLength);
  const view = new DataView(output.buffer);
  writeAscii(output, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(output, 8, 'WAVE');
  writeAscii(output, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, first.channels, true);
  view.setUint32(24, first.sampleRate, true);
  view.setUint32(28, first.sampleRate * first.channels * 2, true);
  view.setUint16(32, first.channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(output, 36, 'data');
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (const chunk of chunks) {
    output.set(chunk.bytes, offset);
    offset += chunk.bytes.byteLength;
  }
  return output;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++)
    target[offset + index] = value.charCodeAt(index);
}

export interface CaptureSnapshot {
  readonly bytes: Uint8Array;
  readonly durationSeconds: number;
  readonly byteLength: number;
}

/** Opt-in per-run recording, so a surface can offer the audio it just played as a download. */
export class PcmCapture {
  private chunks: AudioChunk[] = [];

  reset(): void {
    this.chunks = [];
  }

  append(chunk: AudioChunk): void {
    this.chunks.push({ ...chunk, bytes: new Uint8Array(chunk.bytes) });
  }

  snapshot(): CaptureSnapshot | null {
    if (this.chunks.length === 0) return null;
    const bytes = encodeWave(this.chunks);
    return {
      bytes,
      durationSeconds: this.chunks.reduce((sum, chunk) => sum + chunk.durationSeconds, 0),
      byteLength: bytes.byteLength
    };
  }
}
