import type { NoteEvent } from '../note-event.js';
import { AldaParseError } from './errors.js';
import { durationToBeats, toMidiPitch } from './pitch.js';
import { tokenizeAlda } from './tokenizer.js';

const DEFAULT_OCTAVE = 4;
const DEFAULT_DURATION = 1;
const DEFAULT_VELOCITY = 69;

export function parseAlda(source: string): NoteEvent[] {
  let octave = DEFAULT_OCTAVE;
  let defaultDuration = DEFAULT_DURATION;
  let cursor = 0;
  const events: NoteEvent[] = [];

  for (const token of tokenizeAlda(source)) {
    switch (token.type) {
      case 'octave':
        octave = token.octave;
        break;
      case 'octave-up':
        octave++;
        break;
      case 'octave-down':
        octave--;
        break;
      case 'note': {
        let duration: number;
        if (token.length === undefined) {
          if (token.dots > 0) {
            // A bare dot would have to modify the inherited length, but that
            // length may already be dotted — refuse rather than guess.
            throw new AldaParseError(
              'A dotted note needs an explicit length, e.g. c2. — a dot cannot modify the inherited length.',
              token.offset
            );
          }
          duration = defaultDuration;
        } else {
          duration = durationToBeats(token.length, token.dots, token.offset);
          defaultDuration = duration;
        }
        events.push({
          pitch: toMidiPitch(token.letter, token.accidental, octave, token.offset),
          start: cursor,
          duration,
          velocity: DEFAULT_VELOCITY
        });
        cursor += duration;
        break;
      }
      case 'unsupported':
        throw new AldaParseError(token.message, token.offset);
    }
  }

  return events;
}
