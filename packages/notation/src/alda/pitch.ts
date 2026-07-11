import { AldaParseError } from './errors.js';

const PITCH_CLASSES = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11
} as const;

export type NoteLetter = keyof typeof PITCH_CLASSES;

export function toMidiPitch(
  letter: NoteLetter,
  accidental: number,
  octave: number,
  offset: number
): number {
  const pitch = (octave + 1) * 12 + PITCH_CLASSES[letter] + accidental;
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
    const accidentalText = accidental > 0 ? '+'.repeat(accidental) : '-'.repeat(-accidental);
    throw new AldaParseError(
      `MIDI pitch out of range for ${letter}${accidentalText} (octave ${octave})`,
      offset
    );
  }
  return pitch;
}

export function durationToBeats(noteValue: number, dots: number, offset: number): number {
  if (!Number.isInteger(noteValue) || noteValue <= 0) {
    throw new AldaParseError('Note length must be a positive integer.', offset);
  }
  const base = 4 / noteValue;
  return dots === 0 ? base : base * (2 - 2 ** -dots);
}
