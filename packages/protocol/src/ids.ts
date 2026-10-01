// How a display name becomes a timeline id segment. This lives in Protocol
// because it is a property of the id format, not of the compiler: the compiler
// derives `track.<slug>` for an authored track and a host derives the same id
// for a live `DeclareTrack "<name>"`, so the two must agree exactly. Protocol
// depends on nothing, so sharing the rule costs neither side a dependency.
//
// Timeline ids use the protocol LocalId grammar — lowercase segments joined by
// '.', '-' or '_', the first segment starting with a letter. A slug only ever
// appears as a trailing segment, after a fixed literal one (`track`, `section`,
// `default`, `event`), so it never has to start with a letter itself.

/**
 * Reduce an arbitrary name to a single LocalId segment: lowercase, non
 * `[a-z0-9]` runs collapsed to '-', no leading or trailing separators. A name
 * with nothing usable in it becomes 'x', so the result is always a legal
 * segment.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'x';
}
