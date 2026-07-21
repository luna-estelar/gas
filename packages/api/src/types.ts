// Public result, warning, error, and state shapes the session hands back to a
// host. Warnings and command failures are Core's plain objects, enriched only
// with what the API owns: a `warningId` (so a host renders one channel) and, for
// commands applied during playback, the Renderer's requested/applied positions.

import type { CommandFailure, CommandWarning } from '@luna-estelar/gas-core';
import type { GasDiagnostic } from '@luna-estelar/gas-language';
import type {
  ConnectorFailureReason,
  MusicalPosition,
  RendererLifecycle
} from '@luna-estelar/gas-protocol';

export type PlaybackPhase = 'stopped' | 'active';

// A Core warning plus the id it shares between the result it rode in on and the
// `warning` event that mirrors it. Its `intent` field distinguishes it from a
// `PlaybackWarning` on the shared warning channel.
export interface SessionWarning extends CommandWarning {
  readonly warningId: string;
}

// A provider or playback warning that originates in the Renderer, not Core. It
// rides the same `warning` channel (so a host renders one channel) but never
// appears on a command result — no command produced it.
export interface PlaybackWarning {
  readonly warningId: string;
  readonly code: string;
  readonly message: string;
  readonly runId?: string;
}

// The union carried on the `warning` event channel.
export type WarningEvent = SessionWarning | PlaybackWarning;

// "Accepted now, audible at bar N": present only for commands applied while the
// session is active. A stopped command carries neither.
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

// Partial success: earlier statements committed, then one failed. Resolves (does
// not reject) so the host learns how far the batch got and why it stopped.
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
