// The positions where authored state can change, in order and without
// duplicates. The session sends an update at each, and a CLI can scrub through
// them. The caller derives the state at each with `effectiveStateAt`. Only the
// timeline is used. The start of a Play and loop boundaries are not included.

import type { MusicalPosition, Timeline } from '../protocol/index.js';
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
