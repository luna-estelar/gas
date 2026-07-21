// Allocate warning IDs and emit session events. The session filters stale runs
// before forwarding renderer position and audio events.

import type {
  AudioChunk,
  CommandWarning,
  DiagnosticEvent,
  LifecycleEvent,
  PlaybackWarning,
  RendererPositionEvent,
  RendererWarning,
  SessionState,
  SessionWarning,
  WarningEvent
} from '@luna-estelar/gas-protocol';
import type { GasOperationError } from './types.js';

export type { DiagnosticEvent, LifecycleEvent } from '@luna-estelar/gas-protocol';

export interface SessionEventMap {
  readonly state: SessionState;
  readonly lifecycle: LifecycleEvent;
  readonly position: RendererPositionEvent;
  readonly audio: AudioChunk;
  readonly warning: WarningEvent;
  readonly error: GasOperationError;
  readonly diagnostic: DiagnosticEvent;
}

export type SessionEvent = keyof SessionEventMap;
type Listener<T> = (payload: T) => void;

export class EventHub {
  private readonly channels: { [K in SessionEvent]: Set<Listener<SessionEventMap[K]>> } = {
    state: new Set(),
    lifecycle: new Set(),
    position: new Set(),
    audio: new Set(),
    warning: new Set(),
    error: new Set(),
    diagnostic: new Set()
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
    // Snapshot first: a listener that unsubscribes mid-dispatch must not perturb
    // the set we are iterating.
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
  warn(warning: CommandWarning): SessionWarning {
    const sessionWarning: SessionWarning = { ...warning, warningId: this.nextWarningId() };
    this.emit('warning', sessionWarning);
    return sessionWarning;
  }

  // Renderer warning: same channel, its own id, event only (no result carries
  // it, since no command produced it).
  warnRenderer(warning: RendererWarning): PlaybackWarning {
    const playbackWarning: PlaybackWarning = {
      warningId: this.nextWarningId(),
      code: warning.code,
      message: warning.message,
      ...(warning.runId !== undefined ? { runId: warning.runId } : {})
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
