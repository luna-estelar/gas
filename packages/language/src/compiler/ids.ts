// Deterministic identifier derivation for compiled timelines. Timeline ids use
// the protocol LocalId grammar — lowercase segments joined by '.', '-', or '_',
// with the first segment starting with a letter. We always prefix an id with a
// fixed literal segment (`track`, `section`, `default`, `event`), so a
// slugified name only ever appears as a trailing segment and never has to start
// with a letter itself.

// The name-to-segment rule itself belongs to the id format, so Protocol owns it:
// a host deriving the id of a live track declaration has to land on the same
// string this compiler does, without depending on the compiler to do it.
export { slugify } from '@luna-estelar/gas-protocol';

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
