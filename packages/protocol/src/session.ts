import type { CommandFailure, CommandWarning, GasDiagnostic } from './diagnostics.js';
import type { MusicalPosition, Timeline } from './timeline.js';
import type { ConnectorStreamStatus, PlaybackStatus, RendererLifecycle } from './renderer.js';

export type PlaybackPhase = 'stopped' | 'active';

export interface CompileResult {
  readonly timeline: Timeline;
  readonly diagnostics: readonly GasDiagnostic[];
}

export interface SessionWarning extends CommandWarning {
  readonly warningId: string;
}

export interface LoadResult {
  readonly warnings: readonly SessionWarning[];
}

export interface PlaybackWarning {
  readonly warningId: string;
  readonly code: string;
  readonly message: string;
  readonly runId?: string;
}

export type WarningEvent = SessionWarning | PlaybackWarning;

export interface AppliedPosition {
  readonly requestedPosition?: MusicalPosition;
  readonly appliedPosition?: MusicalPosition;
}

export interface CommandResult extends AppliedPosition {
  readonly warnings: readonly SessionWarning[];
}

export interface LiveCommandSuccess extends AppliedPosition {
  readonly ok: true;
  readonly applied: number;
  readonly warnings: readonly SessionWarning[];
}

export interface LiveCommandFailureResult {
  readonly ok: false;
  readonly applied: number;
  readonly warnings: readonly SessionWarning[];
  readonly failure: CommandFailure;
}

export type LiveCommandResult = LiveCommandSuccess | LiveCommandFailureResult;

export interface TrackView {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly source: 'authored' | 'host';
}

export interface SessionState {
  readonly lifecycle: RendererLifecycle;
  readonly playback: PlaybackPhase;
  readonly timelineLoaded: boolean;
  readonly runId?: string;
  readonly tracks: readonly TrackView[];
}

export interface LifecycleEvent {
  readonly lifecycle: RendererLifecycle;
  readonly playback: PlaybackPhase;
  readonly rendererPlayback: PlaybackStatus;
  readonly runId?: string;
  readonly stream?: ConnectorStreamStatus;
  readonly throttled?: boolean;
  // Set on the event that ends a finite piece, so a host can tell a piece that
  // finished from one the host stopped.
  readonly completed?: true;
}

export interface DiagnosticEvent {
  readonly source: 'compile';
  readonly diagnostics: readonly GasDiagnostic[];
}
