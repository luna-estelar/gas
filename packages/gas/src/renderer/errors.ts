import { ConnectorError } from '../protocol/index.js';
import type {
  ConnectorConfigProblem,
  ConnectorFailureReason,
  TimelineProblem
} from '../protocol/index.js';
import type { RendererFailure } from './types.js';

type RendererErrorCode =
  'wrong-state' | 'invalid-timeline' | 'invalid-configuration' | 'connection-failed' | 'cancelled';

type RendererProblem = ConnectorConfigProblem | TimelineProblem;

export class RendererError extends Error {
  readonly code: RendererErrorCode;
  readonly failure?: RendererFailure;
  /** Config problems from the connector, or timeline problems from Core. */
  readonly problems?: readonly RendererProblem[];

  constructor(
    code: RendererErrorCode,
    message: string,
    options: {
      readonly failure?: RendererFailure;
      readonly problems?: readonly RendererProblem[];
    } = {}
  ) {
    super(message);
    this.name = 'RendererError';
    this.code = code;
    this.failure = options.failure;
    this.problems = options.problems;
  }
}

interface ConnectorFailureFallback {
  readonly code: string;
  readonly message: string;
  readonly reason: ConnectorFailureReason;
  readonly retryable: boolean;
}

/**
 * Builds a {@link RendererFailure} from a caught value. A {@link ConnectorError}
 * keeps its `code`, `reason`, `retryable` and `closeCode`. Anything else gets the
 * fallback's. The message is always the fallback's, so connector text never
 * reaches the app.
 */
export function classifyConnectorFailure(
  thrown: unknown,
  fallback: ConnectorFailureFallback
): RendererFailure {
  if (ConnectorError.isConnectorError(thrown)) {
    return Object.freeze({
      code: thrown.code,
      message: fallback.message,
      reason: thrown.reason,
      retryable: thrown.retryable,
      ...(thrown.closeCode !== undefined ? { closeCode: thrown.closeCode } : {})
    });
  }
  return Object.freeze({
    code: fallback.code,
    message: fallback.message,
    reason: fallback.reason,
    retryable: fallback.retryable
  });
}
