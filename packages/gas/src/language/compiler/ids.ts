// Deterministic identifier derivation for compiled timelines. The id format and
// `slugify` live in protocol/ids.ts.

export { slugify } from '../../protocol/index.js';

// Return `base`, or `base-2`, `base-3`, ... if `base` is already taken. Records
// the chosen id in `used`. Deterministic: same inputs in the same order always
// produce the same ids.
export function allocateId(base: string, used: Set<string>): string {
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

// Stable, zero-padded event id from a 0-based sequence index (event.0000, ...).
export function eventId(index: number): string {
  return `event.${String(index).padStart(4, '0')}`;
}
