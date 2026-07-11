import { describe, expect, test } from 'vitest';
import { AldaParseError, parseAlda } from '../src/index.js';

describe('parseAlda', () => {
  test('maps pitches, octave commands, and accidentals to MIDI notes', () => {
    expect(parseAlda('o4 c f+ > c < b-')).toMatchObject([
      { pitch: 60, start: 0, duration: 1, velocity: 69 },
      { pitch: 66, start: 1, duration: 1, velocity: 69 },
      { pitch: 72, start: 2, duration: 1, velocity: 69 },
      { pitch: 70, start: 3, duration: 1, velocity: 69 }
    ]);
  });

  test('carries explicit duration defaults and handles dots', () => {
    expect(parseAlda('o4 c2. d e8.. f')).toEqual([
      { pitch: 60, start: 0, duration: 3, velocity: 69 },
      { pitch: 62, start: 3, duration: 3, velocity: 69 },
      { pitch: 64, start: 6, duration: 0.875, velocity: 69 },
      { pitch: 65, start: 6.875, duration: 0.875, velocity: 69 }
    ]);
  });

  test('skips whitespace and line comments', () => {
    expect(parseAlda('  # lead line\n o3 g8 a b > c')).toEqual([
      { pitch: 55, start: 0, duration: 0.5, velocity: 69 },
      { pitch: 57, start: 0.5, duration: 0.5, velocity: 69 },
      { pitch: 59, start: 1, duration: 0.5, velocity: 69 },
      { pitch: 60, start: 1.5, duration: 0.5, velocity: 69 }
    ]);
  });

  test('returns no events for empty or comment-only source', () => {
    expect(parseAlda('\n  # nothing yet\n')).toEqual([]);
  });

  test.each([
    ['chords', 'c/e'],
    ['ties', 'c~d'],
    ['rests', 'r4'],
    ['parenthetical attributes', '(vol 50) c'],
    ['voices', 'V1: c'],
    ['repeats', 'c *2'],
    ['repeat brackets', '[c d]'],
    ['variables', 'x = c'],
    ['percent markers', '%verse c'],
    ['at markers', '@chorus c'],
    ['cram', '{c d}'],
    ['part declarations', 'piano: c'],
    ['absolute milliseconds', '100ms'],
    ['absolute seconds', '2s'],
    ['key signatures', 'key-signature c']
  ])('throws AldaParseError for deferred construct: %s', (_name, source) => {
    expect(() => parseAlda(source)).toThrow(AldaParseError);
  });

  test('includes the source offset on parse errors', () => {
    try {
      parseAlda('o4 c / e');
      throw new Error('Expected parse failure.');
    } catch (error) {
      expect(error).toBeInstanceOf(AldaParseError);
      expect((error as AldaParseError).offset).toBe(5);
    }
  });

  test('names the accidental in out-of-range pitch errors', () => {
    // o9 g+ = MIDI 128, one above the ceiling; the message must distinguish it from g.
    expect(() => parseAlda('o9 g+')).toThrow(/g\+ \(octave 9\)/);
  });

  test('rejects a dot without an explicit length instead of dropping it', () => {
    // `d.` inherits c2's length; silently emitting an undotted d would be wrong.
    expect(() => parseAlda('o4 c2 d.')).toThrow(AldaParseError);
    expect(() => parseAlda('o4 c2 d.')).toThrow(/dotted note needs an explicit length/);
  });
});
