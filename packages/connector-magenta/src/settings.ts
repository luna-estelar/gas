import type { ConnectorSettings } from '@luna-estelar/gas-protocol';
import { ConnectorError } from '@luna-estelar/gas-protocol';
import { MAGENTA_DEFAULT_ENDPOINT } from './constants.js';

/**
 * Where the Magenta bridge listens, and the shared token it may require. The
 * model runs on the listener's own machine, so the default is loopback. How a
 * host obtains a token is the host's concern; this package hands it to the
 * bridge in the first message and nowhere else.
 */
export type MagentaConnectorSettings = {
  /** A `ws:` loopback origin or a `wss:` origin. `ws://127.0.0.1:8765` by default. */
  readonly endpoint?: string;
  readonly token?: string;
};

export type ResolvedMagentaSettings = {
  readonly endpoint: string;
  readonly token?: string;
};

const ALLOWED_KEYS = ['endpoint', 'token'];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function invalidSettings(): never {
  throw new ConnectorError({
    code: 'magenta-invalid-settings',
    reason: 'internal',
    retryable: false
  });
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

/**
 * Reduce an endpoint to its origin. Plain `ws:` is accepted only on loopback,
 * where the audio never crosses a network; anything else must be `wss:`. No
 * userinfo, query, fragment or path, so a credential cannot hide in it.
 */
function validateEndpoint(value: unknown): string {
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
    url.hash !== '' ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    invalidSettings();
  }
  return `${url.protocol}//${url.host}`;
}

export function validateMagentaSettings(settings: ConnectorSettings): ResolvedMagentaSettings {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    return invalidSettings();
  }
  const candidate = settings as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, ALLOWED_KEYS)) invalidSettings();
  const endpoint =
    candidate.endpoint === undefined
      ? MAGENTA_DEFAULT_ENDPOINT
      : validateEndpoint(candidate.endpoint);
  if (candidate.token === undefined) return Object.freeze({ endpoint });
  if (typeof candidate.token !== 'string' || candidate.token.trim() === '') invalidSettings();
  return Object.freeze({ endpoint, token: candidate.token });
}
