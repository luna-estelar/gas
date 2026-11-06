import type { MagentaRt2Translate } from './connection.js';
import { connectorError } from './errors.js';

/**
 * What `createMagentaRt2Connector` takes. The bridge is a separate process (see
 * the package README); nothing here talks to Google.
 */
export type MagentaRt2ConnectorOptions = {
  /** `ws://` for a loopback bridge, otherwise `wss://`. A path is allowed for gateways. */
  readonly endpoint: string;
  /** The bridge's shared token, if it was started with `MRT2_BRIDGE_TOKEN`. */
  readonly token?: string;
  /** Replaces the prompt translation. Defaults to `translatePrompts` with `config.prompt`. */
  readonly translate?: MagentaRt2Translate;
};

const ALLOWED_KEYS = new Set(['endpoint', 'token', 'translate']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function invalidSettings(): never {
  throw connectorError('magenta-rt2-invalid-settings', 'internal', false);
}

/**
 * Plain `ws:` sends audio and the token in the clear, so it is accepted only for
 * a bridge on this machine. Anything that could carry a credential in the URL
 * itself is refused; the token travels in the first message instead.
 */
export function validateEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') invalidSettings();
  let url: URL;
  try {
    url = new URL(value as string);
  } catch {
    return invalidSettings();
  }
  const secure = url.protocol === 'wss:';
  const loopback = url.protocol === 'ws:' && LOOPBACK_HOSTS.has(url.hostname);
  if (
    !(secure || loopback) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    invalidSettings();
  }
  return url.href;
}

/** Checks the factory's options, and normalises the endpoint. */
export function validateMagentaRt2Options(options: unknown): MagentaRt2ConnectorOptions {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    return invalidSettings();
  }
  const candidate = options as Record<string, unknown>;
  if (!Object.keys(candidate).every((key) => ALLOWED_KEYS.has(key))) invalidSettings();
  const { token, translate } = candidate;
  if (token !== undefined && (typeof token !== 'string' || token === '')) invalidSettings();
  if (translate !== undefined && typeof translate !== 'function') invalidSettings();
  return Object.freeze({
    endpoint: validateEndpoint(candidate.endpoint),
    ...(token !== undefined ? { token: token as string } : {}),
    ...(translate !== undefined ? { translate: translate as MagentaRt2Translate } : {})
  });
}
