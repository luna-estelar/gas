import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { compileSource, type AldaValue, type Timeline } from '../packages/language/src/index.js';
import { parseAlda, toMidi } from '../packages/notation/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusRoot = path.resolve(here, '../packages/language/test/corpus');
const corpusFiles = readdirSync(corpusRoot)
  .filter((entry) => entry.endsWith('.gas'))
  .sort();

describe('notation covers the language corpus Alda subset', () => {
  test('every corpus Alda value parses and encodes as MIDI', () => {
    const midiOutputs: Uint8Array[] = [];

    for (const file of corpusFiles) {
      const source = readFileSync(path.join(corpusRoot, file), 'utf8');
      const result = compileSource(source, { name: file });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        continue;
      }

      for (const alda of collectAldaValues(result.timeline)) {
        const events = parseAlda(alda.source);
        expect(events.length).toBeGreaterThan(0);
        const midi = toMidi(events);
        expect(ascii(midi, 0, 4)).toBe('MThd');
        expect(ascii(midi, 14, 18)).toBe('MTrk');
        midiOutputs.push(midi);
      }
    }

    expect(midiOutputs.length).toBeGreaterThan(0);
  });
});

function collectAldaValues(timeline: Timeline): AldaValue[] {
  const values: AldaValue[] = [];
  for (const track of timeline.tracks) {
    for (const defaultValue of track.defaults) {
      if (defaultValue.value.kind === 'alda') {
        values.push(defaultValue.value);
      }
    }
  }
  for (const event of timeline.events) {
    if ('value' in event && event.value.kind === 'alda') {
      values.push(event.value);
    }
  }
  return values;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
