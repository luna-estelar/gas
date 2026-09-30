// The contract between a browser session and whatever turns renderer chunks into
// sound. The session drives it and never reaches past it, so an AudioWorklet
// engine can replace the buffer-source one without the session changing.
import type { AudioChunk, MonotonicClock } from '@luna-estelar/gas-protocol';
import type { PcmCapture } from '../capture.js';

export type AudioState = 'idle' | 'buffering' | 'playing' | 'underrun' | 'stopped';

export interface AudioStatus {
  readonly state: AudioState;
  /** Received but not yet played: queued audio plus scheduled audio still ahead. */
  readonly bufferedSeconds: number;
  /** Times this run's audio ran out before the next chunk arrived. */
  readonly underruns: number;
}

export interface AudioWarning {
  readonly code: 'format-mismatch' | 'chunk-rejected' | 'context-suspended';
  readonly sequence?: number;
}

export interface EngineOptions {
  /**
   * The lead between a chunk's arrival and its playback, not the amount of audio
   * in a queue. A real-time model delivers chunk N at about the time chunk N − 1
   * starts, so this delay is the whole margin against a late chunk.
   */
  readonly prebufferSeconds: number;
  /** Records every accepted chunk of the current run. */
  readonly capture?: PcmCapture;
  /** Times the prebuffer. Defaults to an `AudioClock` on the engine's context. */
  readonly clock?: MonotonicClock;
}

export interface PlaybackEngine {
  push(chunk: AudioChunk): void;
  /** Drop everything, ramping the gain to 0 over about 20 ms first. */
  flush(): void;
  fadeOut(seconds: number): Promise<void>;
  restoreGain(): void;
  status(): AudioStatus;
  on(event: 'status', listener: (status: AudioStatus) => void): () => void;
  on(event: 'warning', listener: (warning: AudioWarning) => void): () => void;
  /** Context time at which the chunk with this sequence starts, or undefined. */
  startTimeOf(sequence: number): number | undefined;
  /**
   * Seconds of the current run's audio that have reached the listener, from actual
   * scheduled playback: undefined before the first chunk is scheduled; frozen at the end
   * of the last scheduled audio while rebuffering after an underrun; otherwise
   * (currentTime − outputLatency − runStart − pausedSeconds), clamped to [0, delivered].
   */
  playheadSeconds(): number | undefined;
  /** Stops and disconnects. Never closes the AudioContext; the owner does. */
  close(): Promise<void>;
}
