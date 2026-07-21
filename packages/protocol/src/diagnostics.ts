import type { IntentKeyword, IntentSupport } from './capabilities.js';
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
  | 'invalid-playback';

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
