// The configuration the Magenta connector validates by hand must agree with the
// schema it advertises, for the same reason as test/lyria-config.test.ts: the
// Renderer cannot compile the schema under a Content Security Policy without
// 'unsafe-eval', so this comparison against AJV keeps the validator honest.
// Root tests may compose package internals; package boundary tests may not.

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsImport, { type FormatsPlugin } from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAGENTA_CONFIG,
  MAGENTA_CONFIG_SCHEMA,
  validateMagentaConfig
} from '../packages/connector-magenta/src/index.js';
import type { ConnectorConfig, JsonValue } from '../packages/protocol/src/index.js';

const addFormats = addFormatsImport as unknown as FormatsPlugin;

function schemaValidator(): (config: ConnectorConfig) => boolean {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(structuredClone(MAGENTA_CONFIG_SCHEMA));
  return (config) => validate(config) === true;
}

interface NumericMember {
  readonly path: readonly [section: 'prompt' | 'generation', key: string];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly integer?: boolean;
}

// Mirrors MAGENTA_CONFIG_SCHEMA. A member added to the schema without a row here
// is caught by the coverage check below, not silently left untested.
const NUMERIC_MEMBERS: readonly NumericMember[] = [
  { path: ['prompt', 'trackWeight'], exclusiveMinimum: 0 },
  { path: ['prompt', 'globalWeight'], exclusiveMinimum: 0 },
  { path: ['prompt', 'minimumPositiveWeight'], exclusiveMinimum: 0 },
  { path: ['generation', 'temperature'], minimum: 0, maximum: 4 },
  { path: ['generation', 'topK'], minimum: 1, maximum: 1024, integer: true },
  { path: ['generation', 'styleGuidance'], minimum: -1, maximum: 7 },
  { path: ['generation', 'notesGuidance'], minimum: -1, maximum: 7 }
];

const ENUM_MEMBERS: readonly {
  readonly path: readonly [section: 'prompt' | 'generation', key: string];
  readonly allowed: readonly string[];
}[] = [
  { path: ['prompt', 'strategy'], allowed: ['per-track', 'global-plus-tracks'] },
  { path: ['generation', 'drums'], allowed: ['auto', 'on', 'off'] }
];

const BOOLEAN_MEMBERS: readonly (readonly [section: 'prompt', key: string])[] = [
  ['prompt', 'describeTempo'],
  ['prompt', 'describeKey']
];

function at(section: string, key: string, value: JsonValue): ConnectorConfig {
  return { [section]: { [key]: value } };
}

/** Every edge a bound has, plus the wrong types and an unknown sibling. */
function edgeCases(member: NumericMember): { label: string; config: ConnectorConfig }[] {
  const [section, key] = member.path;
  const low = member.minimum ?? member.exclusiveMinimum ?? 0;
  const high = member.maximum ?? low + 10;
  const step = member.integer === true ? 1 : 0.5;
  const values: [string, JsonValue][] = [
    ['below the low bound', low - step],
    ['at the low bound', low],
    ['just above the low bound', low + step],
    ['at the high bound', high],
    ['above the high bound', high + step],
    ['a string', 'loud'],
    ['null', null],
    ['a boolean', true],
    ['an array', [1]]
  ];
  if (member.integer === true) values.push(['a fraction', low + 0.5]);
  const cases = values.map(([label, value]) => ({
    label: `${section}/${key} ${label}`,
    config: at(section, key, value)
  }));
  cases.push({
    label: `${section}/${key} beside an unknown sibling`,
    config: { [section]: { [key]: low === 0 && member.exclusiveMinimum === 0 ? 1 : low, nope: 1 } }
  });
  return cases;
}

const CASES: { label: string; config: ConnectorConfig }[] = [
  { label: 'the advertised defaults', config: DEFAULT_MAGENTA_CONFIG },
  { label: 'an empty patch', config: {} },
  { label: 'an unknown root member', config: { tempo: 120 } },
  { label: 'two unknown root members', config: { tempo: 120, key: 'C major' } },
  { label: 'a prompt section that is an array', config: { prompt: [] as unknown as JsonValue } },
  { label: 'a prompt section that is null', config: { prompt: null } },
  // Tempo and pitches come from state; they must not be configurable.
  { label: 'a derived generation member', config: { generation: { pitches: [60] } } },
  ...NUMERIC_MEMBERS.flatMap(edgeCases),
  ...ENUM_MEMBERS.flatMap(({ path: [section, key], allowed }) =>
    [...allowed, 'neither', ''].map((value) => ({
      label: `${section}/${key} is ${JSON.stringify(value)}`,
      config: at(section, key, value)
    }))
  ),
  ...BOOLEAN_MEMBERS.flatMap(([section, key]) =>
    ([true, false, 'yes', 1] as JsonValue[]).map((value) => ({
      label: `${section}/${key} is ${JSON.stringify(value)}`,
      config: at(section, key, value)
    }))
  )
];

describe('Magenta configuration against its own advertised schema', () => {
  const schema = schemaValidator();

  it('covers every member the schema declares', () => {
    const declared = new Set<string>();
    const properties = MAGENTA_CONFIG_SCHEMA.properties as Record<
      string,
      { properties?: Record<string, unknown> }
    >;
    for (const [section, definition] of Object.entries(properties)) {
      for (const key of Object.keys(definition.properties ?? {})) {
        declared.add(`${section}/${key}`);
      }
    }
    const covered = new Set([
      ...NUMERIC_MEMBERS.map(({ path: [section, key] }) => `${section}/${key}`),
      ...ENUM_MEMBERS.map(({ path: [section, key] }) => `${section}/${key}`),
      ...BOOLEAN_MEMBERS.map(([section, key]) => `${section}/${key}`)
    ]);
    expect([...declared].sort()).toEqual([...covered].sort());
  });

  it.each(CASES)('agrees with the schema on $label', ({ config }) => {
    expect(validateMagentaConfig(config).ok).toBe(schema(config));
  });

  it('rejects every non-finite number, including the ones the schema lets through', () => {
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      const bounded = { generation: { temperature: value } } as unknown as ConnectorConfig;
      expect(schema(bounded)).toBe(false);
      expect(validateMagentaConfig(bounded)).toMatchObject({
        ok: false,
        problems: [{ path: '/generation/temperature', code: 'wrong-type' }]
      });
    }

    const unbounded = { prompt: { trackWeight: Infinity } } as unknown as ConnectorConfig;
    expect(schema(unbounded)).toBe(true);
    expect(validateMagentaConfig(unbounded)).toMatchObject({
      ok: false,
      problems: [{ path: '/prompt/trackWeight', code: 'wrong-type' }]
    });
  });

  it('reports every problem at once without echoing values', () => {
    const result = validateMagentaConfig({
      generation: { topK: 2.5, drums: 'loud', seed: 1 },
      prompt: { describeKey: 'yes' }
    });
    expect(result).toMatchObject({
      ok: false,
      problems: [
        { path: '/prompt/describeKey', code: 'wrong-type' },
        { path: '/generation/seed', code: 'unknown-member' },
        { path: '/generation/topK', code: 'wrong-type' },
        { path: '/generation/drums', code: 'not-allowed' }
      ]
    });
    expect(JSON.stringify(result)).not.toContain('loud');
  });
});
