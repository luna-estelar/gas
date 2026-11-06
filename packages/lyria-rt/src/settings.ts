import { ConnectorError } from '@luna-estelar/gas/protocol';
import type { LyriaRtTranslate } from './connection.js';
import { connectorError } from './errors.js';
import type { LyriaRtTransitionFactory } from './transition.js';

/**
 * A key authorized for Lyria RealTime, or a function that fetches one. The
 * function is called once per Play, so it can hand out short-lived tokens.
 */
export type LyriaRtApiKey = string | (() => string | Promise<string>);

/**
 * What `createLyriaRtConnector` takes. How an app obtains the key is up to the
 * app; this package never stores, derives or forwards one anywhere but the
 * transport.
 */
export type LyriaRtConnectorOptions = {
  readonly apiKey: LyriaRtApiKey;
  /** An HTTPS origin that speaks the Lyria RealTime WebSocket protocol. Google's own by default. */
  readonly endpoint?: string;
  /** Replaces the prompt translation. Defaults to `translatePrompts` with `config.prompt`. */
  readonly translate?: LyriaRtTranslate;
  /** Makes each connection's prompt crossfade. Defaults to `createPromptTransition`. */
  readonly transition?: LyriaRtTransitionFactory;
};

const ALLOWED_KEYS = ['apiKey', 'endpoint', 'translate', 'transition'];

function invalidSettings(): never {
  throw connectorError('lyria-rt-invalid-settings', 'internal', false);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

/**
 * Reduce an endpoint to its origin, rejecting anything that could carry a
 * credential or a route: only an `https:` origin with no userinfo, query,
 * fragment or path is a Lyria RealTime endpoint.
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

function isOptionalFunction(value: unknown): boolean {
  return value === undefined || typeof value === 'function';
}

/** Checks the factory's options, and normalises the endpoint to its origin. */
export function validateLyriaRtOptions(options: unknown): LyriaRtConnectorOptions {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    return invalidSettings();
  }
  const candidate = options as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, ALLOWED_KEYS)) invalidSettings();
  const { apiKey, endpoint, translate, transition } = candidate;
  const keyIsValid =
    typeof apiKey === 'function' || (typeof apiKey === 'string' && apiKey.trim() !== '');
  if (!keyIsValid || !isOptionalFunction(translate) || !isOptionalFunction(transition)) {
    invalidSettings();
  }
  return Object.freeze({
    apiKey: apiKey as LyriaRtApiKey,
    ...(endpoint !== undefined ? { endpoint: validateEndpoint(endpoint) } : {}),
    ...(translate !== undefined ? { translate: translate as LyriaRtTranslate } : {}),
    ...(transition !== undefined ? { transition: transition as LyriaRtTransitionFactory } : {})
  });
}

function keyUnavailable(): ConnectorError {
  // Fetching a token usually fails for a passing reason, so the app can offer
  // "Try again".
  return connectorError('lyria-rt-api-key-unavailable', 'auth', true);
}

/** The key for one connection. A function key is called each time. */
export async function resolveApiKey(apiKey: LyriaRtApiKey): Promise<string> {
  if (typeof apiKey === 'string') return apiKey;
  let value: unknown;
  try {
    value = await apiKey();
  } catch (error) {
    if (ConnectorError.isConnectorError(error)) throw error;
    throw keyUnavailable();
  }
  if (typeof value !== 'string' || value.trim() === '') throw keyUnavailable();
  return value;
}
