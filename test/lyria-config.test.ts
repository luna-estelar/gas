// The configuration the Lyria connector validates by hand must agree with the
// schema it advertises. The Renderer no longer compiles that schema — it cannot,
// under a Content Security Policy without 'unsafe-eval' — so the only thing
// keeping the hand-written validator honest is this comparison against AJV.
// Root tests may compose package internals; package boundary tests may not.

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsImport, { type FormatsPlugin } from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LYRIA_CONFIG,
  LYRIA_CONFIG_SCHEMA,
  validateLyriaConfig
} from '../packages/connector-lyria/src/index.js';
import { applyMergePatch } from '../packages/renderer/src/connector-config.js';
import type { ConnectorConfig, JsonValue } from '../packages/protocol/src/index.js';

const addFormats = addFormatsImport as unknown as FormatsPlugin;

function schemaValidator(): (config: ConnectorConfig) => boolean {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(structuredClone(LYRIA_CONFIG_SCHEMA));
  return (config) => validate(config) === true;
}

interface NumericMember {
  readonly path: readonly [section: 'prompt' | 'generation', key: string];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly integer?: boolean;
}

// Mirrors LYRIA_CONFIG_SCHEMA. A member added to the schema without a row here is
// caught by the coverage check below, not silently left untested.
const NUMERIC_MEMBERS: readonly NumericMember[] = [
  { path: ['prompt', 'trackWeight'], exclusiveMinimum: 0 },
  { path: ['prompt', 'globalWeight'], exclusiveMinimum: 0 },
  { path: ['prompt', 'minimumPositiveWeight'], exclusiveMinimum: 0 },
  { path: ['prompt', 'transitionDurationMs'], minimum: 0, integer: true },
  { path: ['prompt', 'transitionSteps'], minimum: 1, integer: true },
  { path: ['generation', 'temperature'], minimum: 0, maximum: 3 },
  { path: ['generation', 'guidance'], minimum: 0, maximum: 6 },
  { path: ['generation', 'topK'], minimum: 1, maximum: 1000, integer: true },
  { path: ['generation', 'seed'], minimum: 0, maximum: 2147483647, integer: true },
  { path: ['generation', 'density'], minimum: 0, maximum: 1 },
  { path: ['generation', 'brightness'], minimum: 0, maximum: 1 }
];

const ENUM_MEMBERS: readonly {
  readonly path: readonly [section: 'prompt' | 'generation', key: string];
  readonly allowed: readonly string[];
}[] = [
  { path: ['prompt', 'strategy'], allowed: ['per-track', 'global-plus-tracks'] },
  { path: ['generation', 'mode'], allowed: ['quality', 'diversity'] }
];

const BOOLEAN_MEMBERS: readonly (readonly [section: 'generation', key: string])[] = [
  ['generation', 'muteBass'],
  ['generation', 'muteDrums'],
  ['generation', 'onlyBassAndDrums']
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
  { label: 'the advertised defaults', config: DEFAULT_LYRIA_CONFIG },
  { label: 'an empty patch', config: {} },
  { label: 'an unknown root member', config: { tempo: 120 } },
  { label: 'two unknown root members', config: { tempo: 120, key: 'C major' } },
  { label: 'a prompt section that is an array', config: { prompt: [] as unknown as JsonValue } },
  { label: 'a prompt section that is null', config: { prompt: null } },
  // The transport derives scale from state; it must not be configurable.
  { label: 'a derived generation member', config: { generation: { scale: 'C_MAJOR_A_MINOR' } } },
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

describe('Lyria configuration against its own advertised schema', () => {
  const schema = schemaValidator();

  it('covers every member the schema declares', () => {
    const declared = new Set<string>();
    const properties = LYRIA_CONFIG_SCHEMA.properties as Record<
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
    expect(validateLyriaConfig(config).ok).toBe(schema(config));
  });

  it('rejects every non-finite number, including the ones the schema lets through', () => {
    // A bound comparison fails for NaN either way, so the two agree there. An
    // unbounded member is where they part: `Infinity` satisfies `exclusiveMinimum`
    // and JSON Schema has nothing else to say about it, but it cannot survive a
    // JSON round trip, so the connector refuses to send it.
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      const bounded = { generation: { temperature: value } } as unknown as ConnectorConfig;
      expect(schema(bounded)).toBe(false);
      expect(validateLyriaConfig(bounded)).toMatchObject({
        ok: false,
        problems: [{ path: '/generation/temperature', code: 'wrong-type' }]
      });
    }

    const unbounded = { prompt: { trackWeight: Infinity } } as unknown as ConnectorConfig;
    expect(schema(unbounded)).toBe(true);
    expect(validateLyriaConfig(unbounded)).toMatchObject({
      ok: false,
      problems: [{ path: '/prompt/trackWeight', code: 'wrong-type' }]
    });
  });

  it('rejects a value that is only shaped like plain JSON', () => {
    // A class instance carries no extra enumerable members, so the schema sees
    // nothing wrong with it. It still has no JSON representation.
    class Configuration {
      readonly generation = { temperature: 1 };
    }
    const config = new Configuration() as unknown as ConnectorConfig;
    expect(schema(config)).toBe(true);
    expect(validateLyriaConfig(config)).toMatchObject({
      ok: false,
      problems: [{ path: '', code: 'wrong-type' }]
    });
  });

  it('accepts a merge patch that removes an optional control with null', () => {
    const withSeed = applyMergePatch(DEFAULT_LYRIA_CONFIG, { generation: { seed: 7 } });
    expect(validateLyriaConfig(withSeed).ok).toBe(true);
    expect(schema(withSeed)).toBe(true);

    const withoutSeed = applyMergePatch(withSeed, { generation: { seed: null } });
    expect((withoutSeed.generation as { seed?: number }).seed).toBeUndefined();
    expect(validateLyriaConfig(withoutSeed).ok).toBe(true);
    expect(schema(withoutSeed)).toBe(true);
  });
});
