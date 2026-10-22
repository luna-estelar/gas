// The pitches GAS asks Magenta RealTime 2 to play. The model takes a set of
// held pitches and places the onsets itself (the engine's auto-strum), so the
// rhythm of a notes or motif value is not rendered, only its pitches.

import type { EffectiveState, IntentValue } from '@luna-estelar/gas-protocol';
import { AldaParseError, parseAlda } from '@luna-estelar/gas-notation';
import { effectiveLevel } from './prompts.js';

export type PitchSelection = {
  /** Sorted, distinct MIDI pitches; `undefined` leaves harmony to the model. */
  readonly pitches?: readonly number[];
  /** True when some notation could not be read and was left out. */
  readonly skipped: boolean;
};

function pitchesOf(value: IntentValue | undefined, into: Set<number>): boolean {
  if (value?.kind !== 'alda') return false;
  try {
    for (const event of parseAlda(value.source)) into.add(event.pitch);
    return false;
  } catch (error) {
    if (error instanceof AldaParseError) return true;
    throw error;
  }
}

/** Pitches from every audible track's notes and motif. */
export function selectPitches(state: EffectiveState): PitchSelection {
  const pitches = new Set<number>();
  let skipped = false;
  for (const track of state.tracks) {
    if (!track.active || effectiveLevel(track) === 0) continue;
    skipped = pitchesOf(track.notes, pitches) || skipped;
    skipped = pitchesOf(track.motif, pitches) || skipped;
  }
  if (pitches.size === 0) return { skipped };
  return { pitches: [...pitches].sort((a, b) => a - b), skipped };
}
