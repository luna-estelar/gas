// Resolve live track references using authored and host-defined tracks.
// New declarations use the compiler's track.<slug> ID scheme; Core checks collisions.

import type { InputState } from '@luna-estelar/gas-core';
import { slugify } from '@luna-estelar/gas-language';

// Resolve a live reference to a Core track id. Display names win over ids and
// authored tracks over host tracks, matching the compiler's first-declared
// precedence; an id is accepted as a fallback so host tracks defined without a
// name are still addressable. Returns undefined when nothing matches.
export function resolveTrackId(state: InputState, reference: string): string | undefined {
  for (const track of state.timeline.tracks) {
    if (track.name === reference) return track.trackId;
  }
  for (const host of state.hostTracks) {
    if (host.name === reference) return host.id;
  }
  for (const track of state.timeline.tracks) {
    if (track.trackId === reference) return track.trackId;
  }
  for (const host of state.hostTracks) {
    if (host.id === reference) return host.id;
  }
  return undefined;
}

// The id a live `DeclareTrack "<name>"` should carry, matching authored tracks.
export function liveTrackId(name: string): string {
  return `track.${slugify(name)}`;
}
