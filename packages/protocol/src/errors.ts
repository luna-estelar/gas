import type { ConnectorFailureReason } from './renderer.js';

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

export interface ConnectorErrorOptions {
  readonly code: string;
  readonly reason: ConnectorFailureReason;
  readonly retryable: boolean;
}

/**
 * The one error shape a connector may throw to hand the Renderer a safe,
 * structured failure classification. The message is fixed by `reason` and never
 * carries caller or vendor text, so provider details and credentials cannot
 * leak through it into diagnostics, warnings, logs, or events.
 */
export class ConnectorError extends Error {
  readonly code: string;
  readonly reason: ConnectorFailureReason;
  readonly retryable: boolean;

  constructor(options: ConnectorErrorOptions) {
    const reason = isConnectorFailureReason(options.reason) ? options.reason : 'internal';
    super(CONNECTOR_FAILURE_MESSAGES[reason]);
    this.name = 'ConnectorError';
    this.code = options.code;
    this.reason = reason;
    this.retryable = options.retryable;
  }

  /**
   * Structural guard so classification survives a connector bundling its own
   * copy of protocol (where `instanceof` alone would miss). Never reads the
   * message and never stringifies the value.
   */
  static isConnectorError(value: unknown): value is ConnectorError {
    if (!(value instanceof Error)) return false;
    if (!(value instanceof ConnectorError) && value.name !== 'ConnectorError') return false;
    const candidate = value as { code?: unknown; reason?: unknown; retryable?: unknown };
    return (
      typeof candidate.code === 'string' &&
      typeof candidate.retryable === 'boolean' &&
      isConnectorFailureReason(candidate.reason)
    );
  }
}

function isConnectorFailureReason(value: unknown): value is ConnectorFailureReason {
  return CONNECTOR_FAILURE_REASONS.includes(value as ConnectorFailureReason);
}
