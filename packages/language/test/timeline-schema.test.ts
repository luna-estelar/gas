import { beforeAll, describe, expect, test } from 'vitest';
import { compileSource } from '../src/index.js';
import { loadTimelineValidator } from './support/schema.js';

// Proves compiled timelines validate against the canonical protocol timeline
// schema, mirroring the Ajv setup in scripts/validate-schemas.mjs.

let validate: ReturnType<typeof loadTimelineValidator>;

beforeAll(() => {
  validate = loadTimelineValidator();
});

const RICH_DOCUMENT = `
tempo 100
time_signature 3/4
key "A minor"
length bars 8
flavor "global flavor"
level 0.9

track pad "warm pad"
track lead "square lead"

pad.timbre "analog"
pad.level 0.5
lead.motif alda(o4 c e g)

section a:
    length bars 8
    flavor "wide"
    lead.flavor "answers"
    bar 1:
        pad.play
        lead.play
    bar 4:
        pad.flavor "brighter"
        pad.level 0.3

a()
`;

const FINITE_DOCUMENT = `
length bars 4
track drums "d"
section intro:
    length bars 4
    bar 1:
        drums.play
intro()
`;

const LOOP_DOCUMENT = `
length bars 4 loop
track drums "d"
section intro:
    length bars 4
    bar 1:
        drums.play
intro()
`;

const INFINITE_DOCUMENT = `
length infinite
track drums "d"
section drone:
    length bars 4
    bar 1:
        drums.play
drone()
`;

const GLOBALS_ONLY_DOCUMENT = `
tempo 120
length bars 4
track drums "d"
`;

const CASES: ReadonlyArray<readonly [name: string, source: string]> = [
  ['rich', RICH_DOCUMENT],
  ['finite', FINITE_DOCUMENT],
  ['loop', LOOP_DOCUMENT],
  ['infinite', INFINITE_DOCUMENT],
  ['globals-only', GLOBALS_ONLY_DOCUMENT]
];

describe('compiled timelines validate against the protocol schema', () => {
  test.each(CASES)('%s document', (_name, source) => {
    const result = compileSource(source);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const valid = validate(result.timeline);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});
