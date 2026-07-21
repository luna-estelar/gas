// Public result, warning, error, and state shapes the session hands back to a
// host. Warnings and command failures are Core's plain objects, enriched only
// with what the API owns: a `warningId` (so a host renders one channel) and, for
// commands applied during playback, the Renderer's requested/applied positions.

import type {
  CommandFailure,
  ConnectorFailureReason,
  GasDiagnostic,
  SessionWarning
} from '@luna-estelar/gas-protocol';

export type {
  AppliedPosition,
  CommandResult,
  LiveCommandFailureResult,
  LiveCommandResult,
  LiveCommandSuccess,
  PlaybackPhase,
  PlaybackWarning,
  SessionState,
  SessionWarning,
  TrackView,
  WarningEvent
} from '@luna-estelar/gas-protocol';

export type OperationErrorKind =
  | 'compile'
  | 'validate'
  | 'command'
  | 'live'
  | 'playback'
  | 'renderer'
  | 'lifecycle';

export interface OperationErrorInit {
  readonly kind: OperationErrorKind;
  readonly failure?: CommandFailure;
  readonly diagnostics?: readonly GasDiagnostic[];
  readonly warnings?: readonly SessionWarning[];
  readonly reason?: ConnectorFailureReason;
  readonly cause?: unknown;
}

// The single structured error every rejecting operation throws. Carries the
// underlying Core failure, compile/validation diagnostics, any warnings already
// produced, and a connector failure reason when one is known.
export class GasOperationError extends Error {
  readonly kind: OperationErrorKind;
  readonly failure?: CommandFailure;
  readonly diagnostics: readonly GasDiagnostic[];
  readonly warnings: readonly SessionWarning[];
  readonly reason?: ConnectorFailureReason;
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
    if (init.cause !== undefined) this.cause = init.cause;
  }
}
