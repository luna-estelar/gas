import type { ConnectorSettings } from '@luna-estelar/gas/protocol';
import { ConnectorError } from '@luna-estelar/gas/protocol';

/**
 * Where the bridge is and, if it asks for one, the shared token. The bridge is a
 * separate process (see the package README); nothing here talks to Google.
 */
export type MagentaRt2ConnectorSettings = {
  /** `ws://` for a loopback bridge, otherwise `wss://`. A path is allowed for gateways. */
  readonly endpoint: string;
  readonly token?: string;
};

const ALLOWED_KEYS = new Set(['endpoint', 'token']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function invalidSettings(): never {
  throw new ConnectorError({
    code: 'magenta-rt2-invalid-settings',
    reason: 'internal',
    retryable: false
  });
}

/**
 * Plain `ws:` sends audio and the token in the clear, so it is accepted only for
 * a bridge on this machine. Anything that could carry a credential in the URL
 * itself is refused; the token travels in the first message instead.
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
    url.hash !== ''
  ) {
    invalidSettings();
  }
  return url.href;
}

export function validateMagentaRt2Settings(
  settings: ConnectorSettings
): MagentaRt2ConnectorSettings {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    return invalidSettings();
  }
  const candidate = settings as Record<string, unknown>;
  if (!Object.keys(candidate).every((key) => ALLOWED_KEYS.has(key))) invalidSettings();
  const endpoint = validateEndpoint(candidate.endpoint);
  if (candidate.token === undefined) return Object.freeze({ endpoint });
  if (typeof candidate.token !== 'string' || candidate.token === '') invalidSettings();
  return Object.freeze({ endpoint, token: candidate.token });
}
