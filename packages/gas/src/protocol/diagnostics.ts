import type { IntentKeyword, IntentSupport } from './capabilities.js';
import type { AppValueCommand } from './commands.js';
import type { SourceRange } from './timeline.js';

export type GasDiagnosticSeverity = 'error' | 'warning' | 'info';

export type GasDiagnosticCategory = 'syntax' | 'semantic' | 'deferred' | 'informational';

export interface GasDiagnostic {
  readonly code: string;
  readonly category: GasDiagnosticCategory;
  readonly severity: GasDiagnosticSeverity;
  readonly message: string;
  readonly range?: SourceRange;
}

export type TimelineProblemCode =
  | 'unsupported-format-version'
  | 'invalid-shape'
  | 'duplicate-id'
  | 'unresolved-reference'
  | 'position-out-of-range'
  | 'arrangement-not-contiguous'
  | 'invalid-level'
  | 'invalid-playback'
  | 'events-unordered'
  | 'sequence-collision'
  | 'beat-out-of-range'
  | 'event-outside-section';

export interface TimelineProblem {
  readonly code: TimelineProblemCode;
  readonly message: string;
}

export interface ValidateTimelineResult {
  readonly ok: boolean;
  readonly problems: readonly TimelineProblem[];
}

export type CommandFailureCode =
  | 'duplicate-track'
  | 'unknown-track'
  | 'not-app-track'
  | 'invalid-level'
  | 'invalid-tempo'
  | 'invalid-value';

export interface CommandFailure {
  readonly code: CommandFailureCode;
  readonly message: string;
  readonly trackId?: string;
}

export interface CommandWarning {
  readonly code: 'unsupported-intent';
  readonly intent: IntentKeyword;
  readonly support: Exclude<IntentSupport, 'supported'>;
  readonly trackId?: string;
  readonly message: string;
}

// A new document was loaded with `appValues: 'keep'`, and this app value's track is gone.
export interface AppValueDroppedWarning {
  readonly code: 'app-value-dropped';
  readonly trackId: string;
  readonly command: AppValueCommand;
  readonly message: string;
}
