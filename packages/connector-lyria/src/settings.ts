import type { ConnectorSettings } from '@luna-estelar/gas-protocol';
import { ConnectorError } from '@luna-estelar/gas-protocol';

/**
 * What the connector needs to reach Lyria: a key, and optionally somewhere other
 * than Google to send it. How a host obtains the key is the host's concern; this
 * package never stores, derives or forwards one anywhere but the transport.
 */
export type LyriaConnectorSettings = {
  readonly apiKey: string;
  /** An HTTPS origin that speaks the Lyria WebSocket protocol. Google's own by default. */
  readonly endpoint?: string;
};

const ALLOWED_KEYS = ['apiKey', 'endpoint'];

function invalidSettings(): never {
  throw new ConnectorError({
    code: 'lyria-invalid-settings',
    reason: 'internal',
    retryable: false
  });
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

/**
 * Reduce an endpoint to its origin, rejecting anything that could carry a
 * credential or a route: only an `https:` origin with no userinfo, query,
 * fragment or path is a Lyria endpoint.
 */
function validateEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') invalidSettings();
  let url: URL;
  try {
    url = new URL(value as string);
  } catch {
    return invalidSettings();
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    invalidSettings();
  }
  return url.origin;
}

export function validateLyriaSettings(settings: ConnectorSettings): LyriaConnectorSettings {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    return invalidSettings();
  }
  const candidate = settings as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, ALLOWED_KEYS)) invalidSettings();
  if (typeof candidate.apiKey !== 'string' || candidate.apiKey.trim() === '') invalidSettings();
  if (candidate.endpoint === undefined) {
    return Object.freeze({ apiKey: candidate.apiKey });
  }
  return Object.freeze({
    apiKey: candidate.apiKey,
    endpoint: validateEndpoint(candidate.endpoint)
  });
}
