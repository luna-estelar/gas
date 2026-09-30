// A scripted AudioContext: device time is a virtual clock the test moves, and
// every node records what the engine asked of it. A source "plays" by firing
// `onended` when the clock passes its end, or its stop time if that is earlier.
import type { AudioChunk } from '@luna-estelar/gas-protocol';
import { VirtualClock } from './virtual-clock.js';

export class FakeAudioParam {
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

export class FakeGainNode {
  readonly gain = new FakeAudioParam();
  connected: unknown;
  disconnected = 0;

  connect(destination: unknown) {
    this.connected = destination;
  }

  disconnect() {
    this.disconnected++;
  }
}

export class FakeAudioBuffer {
  readonly channels: Float32Array[];
  readonly duration: number;

  constructor(
    channelCount: number,
    readonly length: number,
    readonly sampleRate: number
  ) {
    this.channels = Array.from({ length: channelCount }, () => new Float32Array(length));
    this.duration = length / sampleRate;
  }

  getChannelData(channel: number) {
    return this.channels[channel]!;
  }
}

export class FakeBufferSource {
  buffer: FakeAudioBuffer | null = null;
  connected: unknown;
  startedAt: number | undefined;
  stoppedAt: number | undefined;
  ended = false;
  onended: (() => void) | null = null;
  private endTimer: ReturnType<VirtualClock['schedule']> | undefined;

  constructor(private readonly clock: VirtualClock) {}

  connect(destination: unknown) {
    this.connected = destination;
  }

  start(when: number) {
    if (this.startedAt !== undefined) throw new Error('A source starts once.');
    this.startedAt = when;
    this.armEnd(when + (this.buffer?.duration ?? 0));
  }

  stop(when = 0) {
    this.stoppedAt = when;
    if (this.startedAt === undefined || this.ended) return;
    this.armEnd(Math.max(when, this.clock.now()));
  }

  private armEnd(at: number) {
    if (this.endTimer !== undefined) this.clock.cancel(this.endTimer);
    this.endTimer = this.clock.schedule(at, () => {
      this.ended = true;
      this.onended?.();
    });
  }
}

export class FakeAudioContext {
  readonly clock = new VirtualClock();
  readonly destination = {};
  readonly gains: FakeGainNode[] = [];
  readonly buffers: FakeAudioBuffer[] = [];
  readonly sources: FakeBufferSource[] = [];
  outputLatency = 0;
  baseLatency = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
  resumes = 0;
  closes = 0;

  constructor(readonly sampleRate = 48_000) {}

  get currentTime(): number {
    return this.clock.now();
  }

  advanceTo(time: number): void {
    this.clock.advanceTo(time);
  }

  createGain() {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }

  createBuffer(channels: number, frames: number, sampleRate: number) {
    const buffer = new FakeAudioBuffer(channels, frames, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  createBufferSource() {
    const source = new FakeBufferSource(this.clock);
    this.sources.push(source);
    return source;
  }

  async resume() {
    this.resumes++;
    this.state = 'running';
  }

  async close() {
    this.closes++;
    this.state = 'closed';
  }

  /** The engine's master gain: the first node it creates. */
  get master(): FakeGainNode {
    return this.gains[0]!;
  }

  get started(): FakeBufferSource[] {
    return this.sources.filter((source) => source.startedAt !== undefined);
  }

  asContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}

export interface ChunkOptions {
  readonly runId?: string;
  readonly seconds?: number;
  readonly sampleRate?: number;
  readonly channels?: number;
}

/** Silent s16le PCM whose byte length matches its stated duration. */
export function pcmChunk(sequence: number, options: ChunkOptions = {}): AudioChunk {
  const sampleRate = options.sampleRate ?? 48_000;
  const channels = options.channels ?? 2;
  const seconds = options.seconds ?? 2;
  const frames = Math.round(seconds * sampleRate);
  return {
    runId: options.runId ?? 'run-a',
    sequence,
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate,
    channels,
    bytes: new Uint8Array(frames * channels * 2),
    durationSeconds: frames / sampleRate
  };
}
