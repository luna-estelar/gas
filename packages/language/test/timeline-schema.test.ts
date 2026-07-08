import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { compileSource } from '../src/index.js';

// Proves compiled timelines validate against the canonical protocol timeline
// schema, mirroring the Ajv setup in scripts/validate-schemas.mjs.

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaRoot = path.resolve(here, '../../protocol/schemas/1.0');
const TIMELINE_SCHEMA_ID = 'https://gas.luna-estelar.com/protocol/1.0/timeline.schema.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let validate: any;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of readdirSync(schemaRoot).filter((entry) => entry.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(path.join(schemaRoot, file), 'utf8')));
  }
  validate = ajv.getSchema(TIMELINE_SCHEMA_ID);
  if (validate === undefined) {
    throw new Error(`Timeline schema not registered: ${TIMELINE_SCHEMA_ID}`);
  }
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
