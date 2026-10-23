// The bridge wire format, protocol version 1. The authoritative description is
// PROTOCOL.md in the mrt2-bridge repository; this module mirrors it and checks
// everything the bridge sends before the connector acts on it.

import type { WeightedPrompt } from './prompts.js';

export const PROTOCOL_VERSION = 1;
export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
/** Four 40 ms engine frames per packet. */
export const FRAMES_PER_PACKET = 7680;
export const AUDIO_HEADER_BYTES = 16;
const AUDIO_MAGIC = [0x4d, 0x52, 0x54, 0x31]; // "MRT1"

export type ClientMessage =
  | { readonly type: 'hello'; readonly protocol: number; readonly token?: string }
  | {
      readonly type: 'start';
      readonly id: number;
      readonly prompts: readonly WeightedPrompt[];
      readonly temperature?: number;
      readonly topK?: number;
    }
  | { readonly type: 'style'; readonly id: number; readonly prompts: readonly WeightedPrompt[] }
  | { readonly type: 'pause'; readonly id: number; readonly paused: boolean }
  | { readonly type: 'stop'; readonly id: number };

export type ServerHello = {
  readonly type: 'hello';
  readonly protocol: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly encoding: string;
  readonly maxPrompts: number;
};

export type ServerMessage =
  | ServerHello
  | { readonly type: 'ack'; readonly id: number }
  | {
      readonly type: 'error';
      readonly id?: number;
      readonly code: string;
      readonly retryable: boolean;
    };

export type AudioPacket = {
  readonly sequence: number;
  readonly position: number;
  /** Interleaved s16le stereo. */
  readonly pcm: Uint8Array;
  readonly frames: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** A text frame from the bridge, or undefined if it is not one this version knows. */
export function parseServerMessage(text: string): ServerMessage | undefined {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(message)) return undefined;
  switch (message.type) {
    case 'hello': {
      const audio = message.audio;
      if (!isCount(message.protocol) || !isObject(audio) || !isCount(message.maxPrompts)) {
        return undefined;
      }
      if (!isCount(audio.sampleRate) || !isCount(audio.channels)) return undefined;
      if (typeof audio.encoding !== 'string') return undefined;
      return {
        type: 'hello',
        protocol: message.protocol,
        sampleRate: audio.sampleRate,
        channels: audio.channels,
        encoding: audio.encoding,
        maxPrompts: message.maxPrompts
      };
    }
    case 'ack':
      return isCount(message.id) ? { type: 'ack', id: message.id } : undefined;
    case 'error':
      if (typeof message.code !== 'string' || typeof message.retryable !== 'boolean') {
        return undefined;
      }
      if (message.id !== undefined && !isCount(message.id)) return undefined;
      return {
        type: 'error',
        code: message.code,
        retryable: message.retryable,
        ...(message.id !== undefined ? { id: message.id } : {})
      };
    default:
      return undefined;
  }
}

/** A binary frame from the bridge, or undefined if it is malformed. */
export function decodeAudioPacket(data: ArrayBuffer): AudioPacket | undefined {
  const bytes = new Uint8Array(data);
  const payload = bytes.byteLength - AUDIO_HEADER_BYTES;
  const frameBytes = CHANNELS * 2;
  if (payload <= 0 || payload % frameBytes !== 0) return undefined;
  if (!AUDIO_MAGIC.every((byte, index) => bytes[index] === byte)) return undefined;
  const view = new DataView(data);
  const position = view.getBigUint64(8, true);
  if (position > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return {
    sequence: view.getUint32(4, true),
    position: Number(position),
    pcm: bytes.slice(AUDIO_HEADER_BYTES),
    frames: payload / frameBytes
  };
}
