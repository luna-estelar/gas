import type { ConnectorFailureReason } from './connector.js';

const CONNECTOR_FAILURE_REASONS: readonly ConnectorFailureReason[] = [
  'network',
  'auth',
  'quota',
  'provider',
  'internal'
];

const CONNECTOR_FAILURE_MESSAGES: Readonly<Record<ConnectorFailureReason, string>> = {
  network: 'The connector reported a network failure.',
  auth: 'The connector reported an authentication failure.',
  quota: 'The connector reported a quota failure.',
  provider: 'The connector reported a provider failure.',
  internal: 'The connector reported an internal failure.'
};

/**
 * Whether a value is a WebSocket close code, 1000 to 4999. Every close-code
 * check uses this one, so no check is looser than another.
 */
export function isCloseCode(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1000 && value <= 4999;
}

export interface ConnectorErrorOptions {
  readonly code: string;
  readonly reason: ConnectorFailureReason;
  readonly retryable: boolean;
  readonly closeCode?: number;
}

/**
 * The error a connector throws or reports to GAS. The message is fixed by
 * `reason` and never carries caller or vendor text, so provider details and
 * credentials can't leak into diagnostics, warnings, logs or events.
 *
 * `closeCode` is the raw transport close code, passed through so an app can
 * read an application code (4000-4999) the connector doesn't know.
 */
export class ConnectorError extends Error {
  readonly code: string;
  readonly reason: ConnectorFailureReason;
  readonly retryable: boolean;
  readonly closeCode?: number;

  constructor(options: ConnectorErrorOptions) {
    const reason = isConnectorFailureReason(options.reason) ? options.reason : 'internal';
    super(CONNECTOR_FAILURE_MESSAGES[reason]);
    this.name = 'ConnectorError';
    this.code = options.code;
    this.reason = reason;
    this.retryable = options.retryable;
    // Assigned only when valid, so an out-of-range code is dropped rather than
    // carried, and an absent one leaves no own property to serialize.
    if (isCloseCode(options.closeCode)) this.closeCode = options.closeCode;
  }

  /**
   * Structural guard so classification survives a connector bundling its own
   * copy of protocol (where `instanceof` alone would miss). Never reads the
   * message and never stringifies the value. A malformed `closeCode` fails the
   * guard, because a caller that cannot be trusted with the range cannot be
   * trusted with the classification either.
   */
  static isConnectorError(value: unknown): value is ConnectorError {
    if (!(value instanceof Error)) return false;
    if (!(value instanceof ConnectorError) && value.name !== 'ConnectorError') return false;
    const candidate = value as {
      code?: unknown;
      reason?: unknown;
      retryable?: unknown;
      closeCode?: unknown;
    };
    return (
      typeof candidate.code === 'string' &&
      typeof candidate.retryable === 'boolean' &&
      isConnectorFailureReason(candidate.reason) &&
      (candidate.closeCode === undefined || isCloseCode(candidate.closeCode))
    );
  }
}

function isConnectorFailureReason(value: unknown): value is ConnectorFailureReason {
  return CONNECTOR_FAILURE_REASONS.includes(value as ConnectorFailureReason);
}
