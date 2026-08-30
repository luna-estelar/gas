// Resolve hosted access and the optional BYOK fallback independently of runtime composition.
import type { ConnectorSettings } from '@luna-estelar/gas-protocol';

export type Access =
  | { readonly mode: 'byok'; readonly credentials: CredentialCell }
  | { readonly mode: 'hosted'; readonly proxyBaseUrl: string };

export function accessSettings(access: Access): ConnectorSettings {
  return access.mode === 'byok'
    ? { accessMode: 'byok', apiKey: access.credentials.read() }
    : { accessMode: 'hosted', proxyBaseUrl: access.proxyBaseUrl };
}

/**
 * An API key held in memory only, never serialised and clearable on demand.
 * `read()` throws once cleared, so a stale reference cannot resurrect a
 * credential the person has already revoked.
 */
export interface CredentialCell {
  read(): string;
  clear(): void;
  readonly cleared: boolean;
}

export function createCredentialCell(apiKey: string): CredentialCell {
  let key: string | undefined = apiKey;
  return {
    read(): string {
      if (key === undefined) throw new Error('The in-memory credential has been cleared.');
      return key;
    },
    clear(): void {
      key = undefined;
    },
    get cleared(): boolean {
      return key === undefined;
    }
  };
}
