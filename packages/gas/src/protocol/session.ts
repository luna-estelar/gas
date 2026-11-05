import type { Command } from './commands.js';
import type { AppValueDroppedWarning, CommandWarning, GasDiagnostic } from './diagnostics.js';
import type { MusicalPosition, Timeline, TimeSignature } from './timeline.js';

export interface CompileResult {
  readonly timeline: Timeline;
  readonly diagnostics: readonly GasDiagnostic[];
}

export type SessionWarning = (CommandWarning | AppValueDroppedWarning) & {
  readonly warningId: string;
};

export interface LoadResult {
  readonly warnings: readonly SessionWarning[];
}

/** A warning from the connection during a Play. */
export interface PlayWarning {
  readonly warningId: string;
  readonly code: string;
  readonly message: string;
}

export type WarningEvent = SessionWarning | PlayWarning;

export interface AppliedPosition {
  readonly requestedPosition?: MusicalPosition;
  readonly appliedPosition?: MusicalPosition;
}

export interface CommandResult extends AppliedPosition {
  readonly warnings: readonly SessionWarning[];
}

export interface SubmitLiveCommandsResult extends CommandResult {
  /** How many commands were applied. */
  readonly applied: number;
}

export interface TrackView {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly source: 'document' | 'app';
}

/** Defaults for what a document leaves unset. */
export interface DocumentDefaults {
  readonly tempo?: number;
  readonly timeSignature?: TimeSignature;
  readonly key?: string;
}

export type SessionStatus = 'stopped' | 'starting' | 'playing' | 'closed';

/** How the last Play ended. */
export type SessionEnded = 'finished' | 'stopped' | 'failed';

/** Where the session is. One `state` event reports every change to it. */
export interface SessionState {
  readonly status: SessionStatus;
  readonly loaded: boolean;
  /** Why the last Play ended. Absent before the first Play. */
  readonly ended?: SessionEnded;
  readonly tracks: readonly TrackView[];
  /**
   * The app values in effect, as commands: a `defineTrack` for each app track,
   * then the values. Passing them to `apply` or `loadSource({ appValues })`
   * restores them.
   */
  readonly appValues: readonly Command[];
}

/** Where the model has generated up to. It runs ahead of what a listener hears. */
export interface GenerationPositionEvent {
  readonly position: MusicalPosition;
  readonly seconds: number;
  readonly loopIteration: number;
}
