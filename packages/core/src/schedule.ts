// The authored event schedule: the ordered, de-duplicated musical positions at
// which authored effective state can change. These are the Renderer's derivation
// boundaries and the positions a CLI scrubs — positions only, never the events;
// the caller re-derives with `effectiveStateAt` at each. Derived from the
// timeline alone: no input state, no capabilities, no clock. Run start and loop
// boundaries are Renderer-added derivation points, not schedule entries.

import type { MusicalPosition, Timeline } from '@luna-estelar/gas-protocol';
import { comparePositions, positionsEqual } from './positions.js';

export function authoredEventSchedule(timeline: Timeline): readonly MusicalPosition[] {
  const positions: MusicalPosition[] = [];

  // Section starts also mark the expiry of section-scoped values. Include them
  // even when no authored event occurs at the boundary.
  for (const instance of timeline.arrangement) {
    positions.push(instance.start);
  }
  for (const event of timeline.events) {
    positions.push(event.position);
  }

  positions.sort(comparePositions);
  return Object.freeze(dedupeSorted(positions));
}

// Collapses runs of equal positions in an already-sorted list: two events at the
// same bar/beat/offset — or an event sharing a bar with an instance start —
// become one boundary.
function dedupeSorted(sorted: readonly MusicalPosition[]): MusicalPosition[] {
  const unique: MusicalPosition[] = [];
  for (const position of sorted) {
    const last = unique[unique.length - 1];
    if (last === undefined || !positionsEqual(last, position)) {
      unique.push(position);
    }
  }
  return unique;
}
