// Plays renderer chunks as a gapless chain of AudioBufferSourceNodes, each
// started at the exact time the previous one ends on the device clock.
//
// A real-time model delivers each chunk at about the moment the previous one
// has to start, so the only margin against a late chunk is how long playback
// waits after the first one arrives. The engine therefore holds the first chunk
// for `prebufferSeconds` before starting. Counting queued audio instead would
// let one long chunk "fill" the buffer while buying no margin at all.
import type { AudioChunk, ClockTimer, MonotonicClock } from '@luna-estelar/gas-protocol';
import { decodeS16lePcm, type PcmCapture } from '../capture.js';
import { AudioClock } from './clock.js';
import type {
  AudioState,
  AudioStatus,
  AudioWarning,
  EngineOptions,
  PlaybackEngine
} from './engine.js';

// Time between deciding to start and the first sample, so the start is never in
// the past by the time the audio thread sees it.
const START_LEAD_SECONDS = 0.05;
// Long enough that stopping mid-waveform does not click.
const FLUSH_RAMP_SECONDS = 0.02;
const START_TIMES_KEPT = 64;
const MIN_PREBUFFER_SECONDS = 0.25;
const MAX_PREBUFFER_SECONDS = 4;
// Queued durations are sums of frame counts over a rate, so compare with slack.
const EPSILON_SECONDS = 1e-9;
const FRAME_TOLERANCE = 1e-6;

interface Pending {
  readonly buffer: AudioBuffer;
  /** Length in frames at the run's own sample rate. */
  readonly frames: number;
  readonly sequence: number;
}

/**
 * One stretch of gapless playback: from a start, or from the resume after an
 * underrun, to the next underrun. Only its start is rounded to an output frame.
 * Inside it every start time comes from the source frames scheduled so far, so
 * a chunk length that does not convert to whole output frames cannot drift.
 */
interface Segment {
  readonly startFrame: number;
  /** Source frames the run had delivered when the segment began. */
  readonly baseFrames: number;
}

export class ChainedSourceEngine implements PlaybackEngine {
  private readonly master: GainNode;
  private readonly clock: MonotonicClock;
  private readonly ownedClock: AudioClock | undefined;
  private readonly prebufferSeconds: number;
  private readonly capture: PcmCapture | undefined;
  private readonly statusListeners = new Set<(status: AudioStatus) => void>();
  private readonly warningListeners = new Set<(warning: AudioWarning) => void>();
  private readonly active = new Set<AudioBufferSourceNode>();
  private readonly startTimes = new Map<number, number>();
  private state: AudioState = 'idle';
  private closed = false;

  private runId: string | undefined;
  private format: { readonly sampleRate: number; readonly channels: number } | undefined;
  private queue: Pending[] = [];
  private prebufferTimer: ClockTimer | undefined;
  private segment: Segment | undefined;
  // Kept after a resume so the playhead can finish the audio it was still
  // playing out through the output latency.
  private previousSegment: Segment | undefined;
  // Source frames, at the run's rate, handed to the graph so far.
  private deliveredFrames = 0;
  private underruns = 0;
  private gainRestored = false;
  private suspendedReported = false;

  constructor(
    private readonly context: AudioContext,
    options: EngineOptions
  ) {
    this.prebufferSeconds = Math.min(
      MAX_PREBUFFER_SECONDS,
      Math.max(MIN_PREBUFFER_SECONDS, options.prebufferSeconds)
    );
    this.capture = options.capture;
    if (options.clock === undefined) this.ownedClock = new AudioClock(context);
    this.clock = options.clock ?? this.ownedClock!;
    this.master = context.createGain();
    this.master.connect(context.destination);
  }

  push(chunk: AudioChunk): void {
    if (this.closed) return;
    if (chunk.runId !== this.runId) {
      if (this.runId !== undefined) this.flush();
      this.beginRun(chunk.runId);
    }

    let decoded;
    try {
      decoded = decodeS16lePcm(chunk);
    } catch {
      this.warn({ code: 'chunk-rejected', sequence: chunk.sequence });
      return;
    }
    if (this.format === undefined) {
      this.format = { sampleRate: decoded.sampleRate, channels: chunk.channels };
    } else if (
      this.format.sampleRate !== decoded.sampleRate ||
      this.format.channels !== chunk.channels
    ) {
      this.warn({ code: 'format-mismatch', sequence: chunk.sequence });
      return;
    }
    if (this.context.state === 'suspended' && !this.suspendedReported) {
      this.suspendedReported = true;
      this.warn({ code: 'context-suspended', sequence: chunk.sequence });
    }

    // Built at the chunk's own rate; the graph resamples to the device rate.
    const buffer = this.context.createBuffer(chunk.channels, decoded.frames, decoded.sampleRate);
    decoded.channels.forEach((samples, channel) => buffer.getChannelData(channel).set(samples));
    this.capture?.append(chunk);
    const pending: Pending = { buffer, frames: decoded.frames, sequence: chunk.sequence };

    switch (this.state) {
      case 'playing':
      case 'stopped':
        // Stopped with the run still set means the chain ran dry, so this chunk
        // is late however the arithmetic below would read.
        if (this.state === 'stopped' || this.nextStartTime() < this.context.currentTime) {
          this.underruns++;
          this.setState('underrun');
          this.queue = [pending];
          this.startBuffering();
        } else {
          this.schedule(pending);
        }
        return;
      case 'buffering':
      case 'underrun':
        this.queue.push(pending);
        if (this.queueCoversPrebuffer()) this.startPlayback();
        return;
      case 'idle':
        this.queue = [pending];
        this.startBuffering();
        return;
    }
  }

  flush(): void {
    this.cancelPrebuffer();
    const stopAt = this.context.currentTime + FLUSH_RAMP_SECONDS;
    this.rampGainTo0(FLUSH_RAMP_SECONDS);
    for (const source of this.active) {
      try {
        source.stop(stopAt);
      } catch {
        // A source that already ended is harmless.
      }
    }
    this.resetRun(undefined);
    // A session flushes on every renderer stop, including one before any audio.
    if (this.state !== 'idle') this.setState('stopped');
  }

  async fadeOut(seconds: number): Promise<void> {
    if (this.closed) return;
    const duration = Math.max(0, seconds);
    this.rampGainTo0(duration);
    await new Promise<void>((resolve) => {
      this.clock.schedule(this.clock.now() + duration, resolve);
    });
  }

  restoreGain(): void {
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(1, now);
  }

  status(): AudioStatus {
    const queued = this.sourceSeconds(this.queue.reduce((sum, pending) => sum + pending.frames, 0));
    const scheduledAhead =
      this.segment === undefined ? 0 : Math.max(0, this.nextStartTime() - this.context.currentTime);
    return {
      state: this.state,
      bufferedSeconds: queued + scheduledAhead,
      underruns: this.underruns
    };
  }

  on(event: 'status', listener: (status: AudioStatus) => void): () => void;
  on(event: 'warning', listener: (warning: AudioWarning) => void): () => void;
  on(
    event: 'status' | 'warning',
    listener: ((status: AudioStatus) => void) | ((warning: AudioWarning) => void)
  ): () => void {
    const listeners = (event === 'status' ? this.statusListeners : this.warningListeners) as Set<
      typeof listener
    >;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  startTimeOf(sequence: number): number | undefined {
    return this.startTimes.get(sequence);
  }

  // Each segment's reading is capped at the audio it holds, so the silence of a
  // rebuffer is never counted. Until a resumed segment is audible, the reading
  // comes from the one before it, which has either reached its end or is still
  // playing out through the output latency; subtracting the start lead and the
  // latency from the new segment instead would step the playhead backwards.
  playheadSeconds(): number | undefined {
    const segment = this.segment;
    if (segment === undefined) return undefined;
    const base = this.sourceSeconds(segment.baseFrames);
    const heard = this.heardIn(segment, this.deliveredFrames);
    if (heard >= base) return heard;
    const previous = this.previousSegment;
    if (previous === undefined) return base;
    return Math.max(
      this.sourceSeconds(previous.baseFrames),
      this.heardIn(previous, segment.baseFrames)
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cancelPrebuffer();
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    this.active.clear();
    this.resetRun(undefined);
    this.setState('stopped');
    this.master.disconnect();
    this.ownedClock?.dispose();
    this.statusListeners.clear();
    this.warningListeners.clear();
  }

  private get rate(): number {
    return this.context.sampleRate;
  }

  private sourceSeconds(frames: number): number {
    return this.format === undefined ? 0 : frames / this.format.sampleRate;
  }

  private nextStartTime(): number {
    const segment = this.segment;
    if (segment === undefined) return 0;
    return (
      segment.startFrame / this.rate + this.sourceSeconds(this.deliveredFrames - segment.baseFrames)
    );
  }

  /** Run seconds heard through `segment`, capped at `endFrames` but not floored. */
  private heardIn(segment: Segment, endFrames: number): number {
    const latency = Number.isFinite(this.context.outputLatency) ? this.context.outputLatency : 0;
    const base = this.sourceSeconds(segment.baseFrames);
    const heard = base + this.context.currentTime - latency - segment.startFrame / this.rate;
    return Math.min(this.sourceSeconds(endFrames), heard);
  }

  private beginRun(runId: string): void {
    this.resetRun(runId);
    this.capture?.reset();
    this.state = 'idle';
  }

  private resetRun(runId: string | undefined): void {
    this.runId = runId;
    this.format = undefined;
    this.queue = [];
    this.segment = undefined;
    this.previousSegment = undefined;
    this.deliveredFrames = 0;
    this.underruns = 0;
    this.gainRestored = false;
    this.suspendedReported = false;
    this.startTimes.clear();
  }

  private startBuffering(): void {
    this.setState('buffering');
    this.cancelPrebuffer();
    this.prebufferTimer = this.clock.schedule(this.clock.now() + this.prebufferSeconds, () => {
      this.prebufferTimer = undefined;
      this.startPlayback();
    });
    if (this.queueCoversPrebuffer()) this.startPlayback();
  }

  // Audio in hand beyond the chunk that is about to play is margin already
  // earned, so a connector running ahead of real time need not wait out the
  // timer.
  private queueCoversPrebuffer(): boolean {
    let beyondFirst = 0;
    for (let index = 1; index < this.queue.length; index++)
      beyondFirst += this.queue[index]!.frames;
    return this.sourceSeconds(beyondFirst) >= this.prebufferSeconds - EPSILON_SECONDS;
  }

  private startPlayback(): void {
    if (this.state !== 'buffering') return;
    this.cancelPrebuffer();
    // Less a hair, so a time that is a whole frame up to float error stays on it.
    const startFrame = Math.ceil(
      (this.context.currentTime + START_LEAD_SECONDS) * this.rate - FRAME_TOLERANCE
    );
    this.previousSegment = this.segment;
    this.segment = { startFrame, baseFrames: this.deliveredFrames };
    const queued = this.queue;
    this.queue = [];
    for (const pending of queued) this.schedule(pending);
    this.setState('playing');
  }

  private schedule(pending: Pending): void {
    const when = this.nextStartTime();
    // A flush or fade left the gain at 0. The first chunk of a new run brings it
    // back at its own start, after the old run's ramp has finished.
    if (!this.gainRestored) {
      this.master.gain.cancelScheduledValues(when);
      this.master.gain.setValueAtTime(1, when);
      this.gainRestored = true;
    }
    const source = this.context.createBufferSource();
    source.buffer = pending.buffer;
    source.connect(this.master);
    source.onended = () => this.ended(source);
    this.active.add(source);
    source.start(when);
    this.startTimes.set(pending.sequence, when);
    if (this.startTimes.size > START_TIMES_KEPT) {
      this.startTimes.delete(this.startTimes.keys().next().value!);
    }
    this.deliveredFrames += pending.frames;
  }

  private ended(source: AudioBufferSourceNode): void {
    this.active.delete(source);
    // The end of a finished piece, or a chain waiting on a late chunk; the next
    // push tells the two apart.
    if (this.active.size === 0 && this.queue.length === 0 && this.state === 'playing') {
      this.setState('stopped');
    }
  }

  private rampGainTo0(seconds: number): void {
    const now = this.context.currentTime;
    const gain = this.master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + seconds);
  }

  private cancelPrebuffer(): void {
    if (this.prebufferTimer === undefined) return;
    this.clock.cancel(this.prebufferTimer);
    this.prebufferTimer = undefined;
  }

  private setState(state: AudioState): void {
    if (this.state === state) return;
    this.state = state;
    const status = this.status();
    for (const listener of [...this.statusListeners]) listener(status);
  }

  private warn(warning: AudioWarning): void {
    for (const listener of [...this.warningListeners]) listener(warning);
  }
}
