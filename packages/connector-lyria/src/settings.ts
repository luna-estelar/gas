import type { ConnectorSettings } from '@luna-estelar/gas-protocol';
import { ConnectorError } from '@luna-estelar/gas-protocol';

export type LyriaConnectorSettings =
  | { readonly accessMode: 'byok'; readonly apiKey: string }
  | { readonly accessMode: 'hosted'; readonly proxyBaseUrl: string };

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

export function validateLyriaSettings(settings: ConnectorSettings): LyriaConnectorSettings {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    return invalidSettings();
  }
  const candidate = settings as Record<string, unknown>;

  if (candidate.accessMode === 'byok') {
    if (!hasOnlyKeys(candidate, ['accessMode', 'apiKey'])) invalidSettings();
    if (typeof candidate.apiKey !== 'string' || candidate.apiKey.trim() === '') invalidSettings();
    return Object.freeze({ accessMode: 'byok', apiKey: candidate.apiKey });
  }

  if (candidate.accessMode === 'hosted') {
    if (!hasOnlyKeys(candidate, ['accessMode', 'proxyBaseUrl'])) invalidSettings();
    if (typeof candidate.proxyBaseUrl !== 'string' || candidate.proxyBaseUrl.trim() === '') {
      invalidSettings();
    }
    let url: URL;
    try {
      url = new URL(candidate.proxyBaseUrl);
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
    return Object.freeze({ accessMode: 'hosted', proxyBaseUrl: url.origin });
  }

  return invalidSettings();
}
