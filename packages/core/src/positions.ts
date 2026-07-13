// Order absolute musical positions by bar, beat and fractional offset.

import type { BeatOffset, BeatPosition, MusicalPosition } from '@luna-estelar/gas-protocol';

// Orders two positions: bar first, then beat index, then beat offset as a
// fraction. An absent beat is the start of its bar, so it sorts before any
// explicit beat in the same bar; an absent offset is the start of its beat.
// Returns a negative, zero, or positive number like a comparator.
export function comparePositions(a: MusicalPosition, b: MusicalPosition): number {
  if (a.bar !== b.bar) {
    return a.bar - b.bar;
  }
  return compareBeats(a.beat, b.beat);
}

// Compare musical instants when deduplicating schedule boundaries.
export function positionsEqual(a: MusicalPosition, b: MusicalPosition): boolean {
  return comparePositions(a, b) === 0;
}

function compareBeats(a: BeatPosition | undefined, b: BeatPosition | undefined): number {
  if (a === undefined && b === undefined) {
    return 0;
  }
  if (a === undefined) {
    return -1; // a bare bar sorts before any explicit beat in the same bar
  }
  if (b === undefined) {
    return 1;
  }
  if (a.index !== b.index) {
    return a.index - b.index;
  }
  return compareOffsets(a.offset, b.offset);
}

// Compares two offsets by cross-multiplication so exactly-equal fractions with
// different denominators (1/2 vs 2/4) compare equal without floating-point drift.
// Denominators from the compiler are positive; an absent offset is 0/1.
function compareOffsets(a: BeatOffset | undefined, b: BeatOffset | undefined): number {
  const aNumerator = a?.numerator ?? 0;
  const aDenominator = a?.denominator ?? 1;
  const bNumerator = b?.numerator ?? 0;
  const bDenominator = b?.denominator ?? 1;
  return aNumerator * bDenominator - bNumerator * aDenominator;
}
