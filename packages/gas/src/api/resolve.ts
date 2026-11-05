// Resolve live track references using authored and app-defined tracks.
// New declarations use the compiler's track.<slug> ID scheme; Core checks collisions.

import type { InputState } from '../core/index.js';
// From Protocol, not the language barrel: this module is on the eager path of
// every host that imports a session, and the barrel would pull the parser in.
import { slugify } from '../protocol/index.js';

// Resolve a live reference to a Core track id. Display names win over ids and
// authored tracks over app tracks, matching the compiler's first-declared
// precedence; an id is accepted as a fallback so app tracks defined without a
// name are still addressable. Returns undefined when nothing matches.
export function resolveTrackId(state: InputState, reference: string): string | undefined {
  for (const track of state.timeline.tracks) {
    if (track.name === reference) return track.trackId;
  }
  for (const app of state.appTracks) {
    if (app.name === reference) return app.id;
  }
  for (const track of state.timeline.tracks) {
    if (track.trackId === reference) return track.trackId;
  }
  for (const app of state.appTracks) {
    if (app.id === reference) return app.id;
  }
  return undefined;
}

// The id a live `DeclareTrack "<name>"` should carry, matching authored tracks.
export function liveTrackId(name: string): string {
  return `track.${slugify(name)}`;
}
