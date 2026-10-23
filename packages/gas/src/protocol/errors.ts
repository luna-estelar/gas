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

/**
 * The one range a close code may fall in: the WebSocket close-code space, from
 * the protocol codes at 1000 through the application codes ending at 4999. This
 * is the single definition every close-code gate uses — the `ConnectorError`
 * constructor, the structural guard, the JSON Schema range, and the API's
 * failure fields — so no gate can end up looser than another.
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
 * The one error shape a connector may throw to hand the Renderer a safe,
 * structured failure classification. The message is fixed by `reason` and never
 * carries caller or vendor text, so provider details and credentials cannot
 * leak through it into diagnostics, warnings, logs, or events.
 *
 * `closeCode` is the raw transport close code, passed through unclassified so a
 * host can interpret an application code (4000-4999) the connector cannot.
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
