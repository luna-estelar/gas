import { ConnectorError } from '@luna-estelar/gas-protocol';
import type { ConnectorFailureReason, RendererFailure } from '@luna-estelar/gas-protocol';

export type RendererErrorCode =
  | 'renderer-state-conflict'
  | 'invalid-timeline'
  | 'invalid-configuration'
  | 'connector-unavailable'
  | 'renderer-closed';

export class RendererError extends Error {
  readonly code: RendererErrorCode;
  readonly failure?: RendererFailure;
  readonly problems?: readonly unknown[];

  constructor(
    code: RendererErrorCode,
    message: string,
    options: { readonly failure?: RendererFailure; readonly problems?: readonly unknown[] } = {}
  ) {
    super(message);
    this.name = 'RendererError';
    this.code = code;
    this.failure = options.failure;
    this.problems = options.problems;
  }
}

export interface ConnectorFailureFallback {
  readonly code: string;
  readonly message: string;
  readonly reason: ConnectorFailureReason;
  readonly retryable: boolean;
  readonly runId?: string;
}

/**
 * Builds a sanitized {@link RendererFailure} from a caught value. A thrown
 * {@link ConnectorError} keeps its safe classification (`code`/`reason`/`retryable`);
 * every other thrown value falls back to the caller's generic classification. The
 * message is always the caller's renderer-owned text, so connector/vendor message
 * text never reaches an event or thrown error. Unknown values are never inspected
 * beyond the structural {@link ConnectorError.isConnectorError} guard.
 */
export function classifyConnectorFailure(
  thrown: unknown,
  fallback: ConnectorFailureFallback
): RendererFailure {
  const runId = fallback.runId !== undefined ? { runId: fallback.runId } : {};
  if (ConnectorError.isConnectorError(thrown)) {
    return Object.freeze({
      code: thrown.code,
      message: fallback.message,
      reason: thrown.reason,
      retryable: thrown.retryable,
      ...runId
    });
  }
  return Object.freeze({
    code: fallback.code,
    message: fallback.message,
    reason: fallback.reason,
    retryable: fallback.retryable,
    ...runId
  });
}
