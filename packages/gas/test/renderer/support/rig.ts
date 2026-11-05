// A renderer on a virtual clock and a fake connector, with every event recorded.
// Test timelines are 120 BPM 4/4 unless they say otherwise, so a bar lasts 2 s.
import { applyCommand, createInputState } from '../../../src/core/index.js';
import type {
  AudioChunk,
  CapabilitiesTable,
  ConnectorAudioChunk,
  GenerationPositionEvent,
  InputState,
  Timeline
} from '../../../src/protocol/index.js';
import {
  createRenderer,
  type CreateRendererOptions,
  type Renderer,
  type RendererEnd,
  type RendererWarning
} from '../../../src/renderer/index.js';
import {
  FAKE_CHANNELS,
  FAKE_SAMPLE_RATE,
  FakeConnector,
  type FakeConnection,
  type FakeConnectorOptions
} from '../../../../../test/support/fake-connection.js';
import { VirtualClock } from '../../../../../test/support/virtual-clock.js';

export interface Rig {
  readonly clock: VirtualClock;
  readonly connector: FakeConnector;
  readonly renderer: Renderer;
  readonly timeline: Timeline;
  readonly positions: GenerationPositionEvent[];
  readonly audio: AudioChunk[];
  readonly warnings: RendererWarning[];
  readonly ends: RendererEnd[];
}

interface RigOptions {
  readonly connector?: FakeConnector | FakeConnectorOptions;
  readonly renderer?: Partial<Omit<CreateRendererOptions, 'clock' | 'connector'>>;
}

/** A renderer with `timeline` loaded, not yet playing. */
export function rig(timeline: Timeline, options: RigOptions = {}): Rig {
  const clock = new VirtualClock();
  const connector =
    options.connector instanceof FakeConnector
      ? options.connector
      : new FakeConnector(options.connector);
  const renderer = createRenderer({ clock, connector, ...options.renderer });
  renderer.load(timeline, createInputState(timeline));
  const result: Rig = {
    clock,
    connector,
    renderer,
    timeline,
    positions: [],
    audio: [],
    warnings: [],
    ends: []
  };
  renderer.on('generationPosition', (event) => result.positions.push(event));
  renderer.on('audio', (chunk) => result.audio.push(chunk));
  renderer.on('warning', (warning) => result.warnings.push(warning));
  renderer.on('ended', (end) => result.ends.push(end));
  return result;
}

/**
 * Plays and sends `firstAudio` seconds of audio at once, so bar 1 starts at the
 * current clock time. Pass 0 to leave the Play waiting for its first audio.
 */
export async function playing(
  timeline: Timeline,
  options: RigOptions & { readonly firstAudio?: number } = {}
): Promise<Rig & { readonly connection: FakeConnection }> {
  const result = rig(timeline, options);
  await result.renderer.play();
  const connection = result.connector.latest();
  const firstAudio = options.firstAudio ?? 2;
  if (firstAudio > 0) connection.pushAudio(firstAudio);
  return { ...result, connection };
}

export const ALL_SUPPORTED: CapabilitiesTable = {
  intents: {
    flavor: 'supported',
    key: 'supported',
    tempo: 'supported',
    time_signature: 'supported',
    timbre: 'supported',
    level: 'supported',
    notes: 'supported',
    motif: 'supported'
  }
};

export function applyActive(
  state: InputState,
  command: Parameters<typeof applyCommand>[1]
): InputState {
  const result = applyCommand(state, command, { capabilities: ALL_SUPPORTED });
  if (!result.ok) throw new Error(result.failure.message);
  return result.state;
}

/** A chunk in the fake model's format holding exactly `samples`. */
export function samplesChunk(
  samples: readonly number[],
  durationSeconds: number
): ConnectorAudioChunk {
  return {
    bytes: encodeSamples(samples),
    durationSeconds,
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: FAKE_SAMPLE_RATE,
    channels: FAKE_CHANNELS
  };
}

export function encodeSamples(samples: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return bytes;
}

export function decodeSamples(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples: number[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    samples.push(view.getInt16(offset, true));
  }
  return samples;
}

/** Awaits a promise expected to reject, and returns what it rejected with. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to reject.');
}
