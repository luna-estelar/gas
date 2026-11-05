// The results, warnings, errors and state the session hands back to an app.
// Warnings and command failures are Core's plain objects plus a `warningId`, so
// an app shows one channel, and, during a Play, the requested and applied
// positions.

import type {
  CommandFailure,
  ConnectorFailureReason,
  GasDiagnostic,
  SessionWarning
} from '../protocol/index.js';

export type {
  AppliedPosition,
  CommandResult,
  LoadResult,
  PlayWarning,
  DocumentDefaults,
  GenerationPositionEvent,
  SessionEnded,
  SessionState,
  SessionStatus,
  SessionWarning,
  SubmitLiveCommandsResult,
  TrackView,
  WarningEvent
} from '../protocol/index.js';

// What went wrong, so an app can react without reading messages:
// - `document`: the document doesn't compile or isn't a valid timeline
// - `command`: a bad value or an unknown track
// - `state`: the wrong time, such as already playing, nothing loaded, or closed
// - `provider`: the provider failed; `reason`, `retryable` and `closeCode` say how
// - `cancelled`: Stop or Close came before Play resolved
export type OperationErrorKind = 'document' | 'command' | 'state' | 'provider' | 'cancelled';

export interface OperationErrorInit {
  readonly kind: OperationErrorKind;
  readonly failure?: CommandFailure;
  readonly diagnostics?: readonly GasDiagnostic[];
  readonly warnings?: readonly SessionWarning[];
  readonly reason?: ConnectorFailureReason;
  readonly code?: string;
  readonly retryable?: boolean;
  /** The raw transport close code, when the failure came from a closed connection. */
  readonly closeCode?: number;
  readonly cause?: unknown;
}

// The single structured error every rejecting operation throws. Carries the
// underlying Core failure, document diagnostics, any warnings already produced,
// and the connector's safe failure classification when one is known. It never
// derives its public message or fields from raw provider output.
export class GasOperationError extends Error {
  readonly kind: OperationErrorKind;
  readonly failure?: CommandFailure;
  readonly diagnostics: readonly GasDiagnostic[];
  readonly warnings: readonly SessionWarning[];
  readonly reason?: ConnectorFailureReason;
  readonly code?: string;
  readonly retryable?: boolean;
  readonly closeCode?: number;
  // Own field rather than the ES2022 `Error.cause`, so the package stays on the
  // workspace's ES2020 lib.
  readonly cause?: unknown;

  constructor(message: string, init: OperationErrorInit) {
    super(message);
    this.name = 'GasOperationError';
    this.kind = init.kind;
    this.diagnostics = init.diagnostics ?? [];
    this.warnings = init.warnings ?? [];
    if (init.failure !== undefined) this.failure = init.failure;
    if (init.reason !== undefined) this.reason = init.reason;
    if (init.code !== undefined) this.code = init.code;
    if (init.retryable !== undefined) this.retryable = init.retryable;
    if (init.closeCode !== undefined) this.closeCode = init.closeCode;
    if (init.cause !== undefined) this.cause = init.cause;
  }
}
