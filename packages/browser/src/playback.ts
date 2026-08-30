// Web Audio scheduling with an injected AudioContext for playback and testing.
import type { AudioChunk, ClockTimer, MonotonicClock } from '@luna-estelar/gas-protocol';
import type { PcmCapture } from './audio.js';

const START_LEAD_SECONDS = 0.08;

/** Use the audio device clock to keep renderer scheduling aligned with playback. */
export class AudioContextClock implements MonotonicClock {
  constructor(private readonly context: BaseAudioContext) {}

  now(): number {
    return this.context.currentTime;
  }

  schedule(deadlineSeconds: number, callback: () => void): ClockTimer {
    const token = window.setTimeout(
      callback,
      Math.max(0, (deadlineSeconds - this.context.currentTime) * 1000)
    );
    return { token };
  }

  cancel(timer: ClockTimer): void {
    window.clearTimeout(timer.token as number);
  }
}

export class PcmPlayback {
  private readonly master: GainNode;
  private readonly active = new Set<AudioBufferSourceNode>();
  private nextStart = 0;
  private runId: string | undefined;

  /** Pass a `PcmCapture` to record what plays; omit it and nothing is retained. */
  constructor(
    private readonly context: AudioContext,
    private readonly capture?: PcmCapture
  ) {
    this.master = context.createGain();
    this.master.connect(context.destination);
  }

  push(chunk: AudioChunk): void {
    if (chunk.sampleFormat !== 's16le' || chunk.channels < 1 || chunk.sampleRate < 1) return;
    if (this.runId !== undefined && this.runId !== chunk.runId) this.flush();
    this.runId = chunk.runId;

    const bytesPerFrame = chunk.channels * 2;
    const frames = Math.floor(chunk.bytes.byteLength / bytesPerFrame);
    if (frames < 1) return;
    const buffer = this.context.createBuffer(chunk.channels, frames, chunk.sampleRate);
    const view = new DataView(chunk.bytes.buffer, chunk.bytes.byteOffset, chunk.bytes.byteLength);
    for (let channel = 0; channel < chunk.channels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let frame = 0; frame < frames; frame += 1) {
        const offset = (frame * chunk.channels + channel) * 2;
        samples[frame] = view.getInt16(offset, true) / 32768;
      }
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    const start = Math.max(this.context.currentTime + START_LEAD_SECONDS, this.nextStart);
    this.nextStart = start + buffer.duration;
    this.active.add(source);
    source.onended = () => this.active.delete(source);
    this.capture?.append(chunk);
    source.start(start);
  }

  restoreGain(): void {
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(1, now);
  }

  async fadeOut(seconds: number): Promise<void> {
    const duration = Math.max(0, seconds);
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + duration);
    await new Promise<void>((resolve) => window.setTimeout(resolve, duration * 1000));
  }

  flush(): void {
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        // A source that already ended is harmless.
      }
    }
    this.active.clear();
    this.runId = undefined;
    this.nextStart = this.context.currentTime;
    this.capture?.reset();
  }

  async close(): Promise<void> {
    this.flush();
    await this.context.close();
  }
}
