// Allocate warning IDs and emit session events. The renderer only reports the
// current Play, so nothing from an old connection reaches here.

import type {
  AppValueDroppedWarning,
  AudioChunk,
  CommandWarning,
  GenerationPositionEvent,
  PlaybackWarning,
  SessionState,
  SessionWarning,
  WarningEvent
} from '../protocol/index.js';
import type { GasOperationError } from './types.js';

export interface SessionEventMap {
  /** Every change to `SessionState`, once. */
  readonly state: SessionState;
  /** Where the model has generated up to. */
  readonly generationPosition: GenerationPositionEvent;
  readonly audio: AudioChunk;
  readonly warning: WarningEvent;
  /** A provider failure after Play resolved. Every other failure is a rejection. */
  readonly error: GasOperationError;
}

export type SessionEvent = keyof SessionEventMap;
type Listener<T> = (payload: T) => void;

export class EventHub {
  private readonly channels: { [K in SessionEvent]: Set<Listener<SessionEventMap[K]>> } = {
    state: new Set(),
    generationPosition: new Set(),
    audio: new Set(),
    warning: new Set(),
    error: new Set()
  };
  private warningCounter = 0;

  on<K extends SessionEvent>(event: K, listener: Listener<SessionEventMap[K]>): () => void {
    const channel = this.channels[event] as Set<Listener<SessionEventMap[K]>>;
    channel.add(listener);
    return () => {
      channel.delete(listener);
    };
  }

  emit<K extends SessionEvent>(event: K, payload: SessionEventMap[K]): void {
    // Snapshot first, so a listener that unsubscribes mid-dispatch cannot perturb
    // the iteration.
    const channel = this.channels[event] as Set<Listener<SessionEventMap[K]>>;
    for (const listener of [...channel]) {
      try {
        listener(payload);
      } catch {
        // Subscribers are observers. One faulty observer must not interrupt
        // sibling listeners or change the outcome of a session operation.
      }
    }
  }

  // Core warning: allocate an id, emit the event, and return the enriched
  // warning for the operation result — the result and the event share one id.
  warn(warning: CommandWarning | AppValueDroppedWarning): SessionWarning {
    const sessionWarning: SessionWarning = { ...warning, warningId: this.nextWarningId() };
    this.emit('warning', sessionWarning);
    return sessionWarning;
  }

  // Renderer warning: same channel, its own id, event only (no result carries
  // it, since no command produced it).
  warnRenderer(warning: { readonly code: string; readonly message: string }): PlaybackWarning {
    const playbackWarning: PlaybackWarning = {
      warningId: this.nextWarningId(),
      code: warning.code,
      message: warning.message
    };
    this.emit('warning', playbackWarning);
    return playbackWarning;
  }

  private nextWarningId(): string {
    this.warningCounter += 1;
    return `warning.${this.warningCounter}`;
  }

  clear(): void {
    for (const key of Object.keys(this.channels) as SessionEvent[]) {
      this.channels[key].clear();
    }
  }
}
