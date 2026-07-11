import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';
import { compileSource, type AldaValue, type Timeline } from '../src/index.js';
import { loadTimelineValidator } from './support/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusRoot = path.join(here, 'corpus');

let validate: ReturnType<typeof loadTimelineValidator>;

beforeAll(() => {
  validate = loadTimelineValidator();
});

const ALDA_EXPECTATIONS = new Map<string, readonly string[]>([
  [
    'alda-sketch.gas',
    ['\n        o4\n        d4 f a > d2.\n    ', '\n        o2\n        d2. a2. c2.\n    ']
  ],
  [
    'spec-example.gas',
    [
      '\n        o4\n        c8 d e g a4 g8 e\n    ',
      '\n        o3\n        g8 a b > c d e f+ g\n    '
    ]
  ],
  [
    'alda-phrase.gas',
    [
      '\n        o4\n        d8 e f g a4 g8 f\n    ',
      '\n            o4\n            a8 g f e d2\n        '
    ]
  ]
]);

const corpusFiles = readdirSync(corpusRoot)
  .filter((entry) => entry.endsWith('.gas'))
  .sort();

describe('GAS corpus', () => {
  test.each(corpusFiles)(
    '%s compiles and validates against the protocol timeline schema',
    (file) => {
      const source = readFileSync(path.join(corpusRoot, file), 'utf8');
      const result = compileSource(source, { name: file });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      expect(result.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info')).toEqual([]);

      const valid = validate(result.timeline);
      expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);

      const expectedAlda = ALDA_EXPECTATIONS.get(file) ?? [];
      const actualAlda = collectAldaSources(result.timeline);
      expect(actualAlda).toEqual(expectedAlda);

      // The language is model-neutral: no diagnostic may mention a specific model.
      const modelMentions = result.diagnostics.filter((diagnostic) =>
        `${diagnostic.code} ${diagnostic.message}`.toLowerCase().includes('lyria')
      );
      expect(modelMentions).toEqual([]);
    }
  );
});

function collectAldaSources(timeline: Timeline): string[] {
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
  return values.map((value) => value.source);
}
