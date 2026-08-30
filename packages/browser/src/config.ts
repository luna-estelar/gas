// Connector-configuration editing support. A config editor holds a full draft
// object, but the renderer takes a merge patch, so removed optional fields have
// to become explicit nulls rather than silently disappearing.
import type { ConnectorConfig } from '@luna-estelar/gas-protocol';

export function buildMergePatch(current: ConnectorConfig, next: ConnectorConfig): ConnectorConfig {
  return diffObject(current, next);
}

function diffObject(current: ConnectorConfig, next: ConnectorConfig): ConnectorConfig {
  const patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
    const before = current[key];
    const after = next[key];
    if (after === undefined) {
      patch[key] = null;
    } else if (isObject(before) && isObject(after)) {
      const child = diffObject(before, after);
      if (Object.keys(child).length > 0) patch[key] = child;
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
      patch[key] = after;
    }
  }
  return patch as ConnectorConfig;
}

function isObject(value: unknown): value is ConnectorConfig {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
