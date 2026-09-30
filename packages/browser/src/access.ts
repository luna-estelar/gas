// Turn a held credential into connector settings, independently of runtime composition.
import type { ConnectorSettings } from '@luna-estelar/gas-protocol';

/**
 * A key to send, and optionally somewhere other than the provider to send it. How
 * a site obtains the key is the site's own business: a key it asks the person for
 * and a key it fetches from its own endpoint arrive here the same way.
 */
export interface Access {
  readonly credentials: CredentialCell;
  /** An HTTPS origin that speaks the connector's protocol. The provider's own by default. */
  readonly endpoint?: string;
}

export function accessSettings(access: Access): ConnectorSettings {
  return {
    apiKey: access.credentials.read(),
    ...(access.endpoint !== undefined ? { endpoint: access.endpoint } : {})
  };
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
