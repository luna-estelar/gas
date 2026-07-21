// Validates every protocol fixture against its v1.0 JSON Schema using AJV 2020.
// Run with `pnpm check:schemas`. Exits nonzero on any validation failure.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocolRoot = path.join(root, 'packages', 'protocol');
const schemaRoot = path.join(protocolRoot, 'schemas', '1.0');
const fixtureRoot = path.join(protocolRoot, 'test', 'fixtures');

const SCHEMA_BASE = 'https://gas.luna-estelar.com/protocol/1.0';

// Each fixture is validated against an explicit schema or subschema. Keeping
// this map exhaustive ensures a new fixture cannot be added without a target.
const fixtureSchemas = new Map([
  ['capabilities.json', `${SCHEMA_BASE}/capabilities.schema.json`],
  ['command-failure.json', `${SCHEMA_BASE}/diagnostics.schema.json#/$defs/CommandFailure`],
  ['command-warning.json', `${SCHEMA_BASE}/diagnostics.schema.json#/$defs/CommandWarning`],
  ['command.json', `${SCHEMA_BASE}/commands.schema.json#/$defs/Command`],
  ['compiler-diagnostic.json', `${SCHEMA_BASE}/diagnostics.schema.json#/$defs/GasDiagnostic`],
  ['config-schema.json', `${SCHEMA_BASE}/config.schema.json#/$defs/ConnectorConfigSchema`],
  ['connector-config.json', `${SCHEMA_BASE}/config.schema.json#/$defs/ConnectorConfig`],
  ['effective-state.json', `${SCHEMA_BASE}/state.schema.json#/$defs/EffectiveState`],
  ['live-command-result.json', `${SCHEMA_BASE}/session.schema.json#/$defs/LiveCommandResult`],
  ['load-result.json', `${SCHEMA_BASE}/session.schema.json#/$defs/LoadResult`],
  ['renderer-failure.json', `${SCHEMA_BASE}/diagnostics.schema.json#/$defs/RendererFailure`],
  ['renderer-position.json', `${SCHEMA_BASE}/renderer.schema.json#/$defs/RendererPositionEvent`],
  ['renderer-status.json', `${SCHEMA_BASE}/renderer.schema.json#/$defs/RendererStatusEvent`],
  ['renderer-warning.json', `${SCHEMA_BASE}/diagnostics.schema.json#/$defs/RendererWarning`],
  ['session-state.json', `${SCHEMA_BASE}/session.schema.json#/$defs/SessionState`],
  ['timeline-finite.json', `${SCHEMA_BASE}/timeline.schema.json`],
  ['timeline-infinite.json', `${SCHEMA_BASE}/timeline.schema.json`],
  ['timeline-level.json', `${SCHEMA_BASE}/timeline.schema.json`],
  ['timeline-loop.json', `${SCHEMA_BASE}/timeline.schema.json`],
  ['timeline-problem.json', `${SCHEMA_BASE}/diagnostics.schema.json#/$defs/TimelineProblem`]
]);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

for (const file of (await readdir(schemaRoot))
  .filter((entry) => entry.endsWith('.schema.json'))
  .sort()) {
  ajv.addSchema(JSON.parse(await readFile(path.join(schemaRoot, file), 'utf8')));
}

const fixtures = (await readdir(fixtureRoot)).filter((entry) => entry.endsWith('.json')).sort();
assert.deepEqual(
  fixtures,
  [...fixtureSchemas.keys()].sort(),
  'Every protocol fixture must have an explicit schema mapping'
);

const fixtureValues = new Map();
for (const [fixture, schemaId] of fixtureSchemas) {
  const validate = ajv.getSchema(schemaId);
  assert(validate, `Schema should be registered for ${fixture}: ${schemaId}`);
  const example = JSON.parse(await readFile(path.join(fixtureRoot, fixture), 'utf8'));
  fixtureValues.set(fixture, example);
  assert(
    validate(example),
    `${fixture} should validate against ${schemaId}:\n${ajv.errorsText(validate.errors, { separator: '\n' })}`
  );
}

const invalidCases = [
  {
    name: 'timelines require every canonical field',
    schemaId: `${SCHEMA_BASE}/timeline.schema.json`,
    value: Object.fromEntries(
      Object.entries(fixtureValues.get('timeline-infinite.json')).filter(
        ([key]) => key !== 'events'
      )
    )
  },
  {
    name: 'capabilities require every intent',
    schemaId: `${SCHEMA_BASE}/capabilities.schema.json`,
    value: {
      intents: Object.fromEntries(
        Object.entries(fixtureValues.get('capabilities.json').intents).filter(
          ([intent]) => intent !== 'motif'
        )
      )
    }
  },
  {
    name: 'capabilities reject unknown support values',
    schemaId: `${SCHEMA_BASE}/capabilities.schema.json`,
    value: { intents: { ...fixtureValues.get('capabilities.json').intents, motif: 'partial' } }
  },
  {
    name: 'commands reject unknown discriminants',
    schemaId: `${SCHEMA_BASE}/commands.schema.json#/$defs/Command`,
    value: { kind: 'launchTrack', trackId: 'track.pad' }
  },
  {
    name: 'commands reject mismatched value kinds',
    schemaId: `${SCHEMA_BASE}/commands.schema.json#/$defs/Command`,
    value: { kind: 'setTrackLevel', trackId: 'track.pad', value: 'loud' }
  },
  {
    name: 'commands reject extra fields',
    schemaId: `${SCHEMA_BASE}/commands.schema.json#/$defs/Command`,
    value: { kind: 'playTrack', trackId: 'track.pad', extra: true }
  },
  {
    name: 'diagnostics reject unknown categories',
    schemaId: `${SCHEMA_BASE}/diagnostics.schema.json#/$defs/GasDiagnostic`,
    value: { ...fixtureValues.get('compiler-diagnostic.json'), category: 'parser' }
  },
  {
    name: 'diagnostics reject malformed source ranges',
    schemaId: `${SCHEMA_BASE}/diagnostics.schema.json#/$defs/GasDiagnostic`,
    value: {
      ...fixtureValues.get('compiler-diagnostic.json'),
      range: { start: { line: 0, character: -1 }, end: { line: 0, character: 1 } }
    }
  },
  {
    name: 'sessions reject unknown playback phases',
    schemaId: `${SCHEMA_BASE}/session.schema.json#/$defs/SessionState`,
    value: { ...fixtureValues.get('session-state.json'), playback: 'paused' }
  },
  {
    name: 'timelines reject non-1.0 versions',
    schemaId: `${SCHEMA_BASE}/timeline.schema.json`,
    value: {
      ...fixtureValues.get('timeline-infinite.json'),
      formatVersion: { major: 1, minor: 1 }
    }
  },
  {
    name: 'timelines reject extra fields',
    schemaId: `${SCHEMA_BASE}/timeline.schema.json`,
    value: { ...fixtureValues.get('timeline-infinite.json'), extension: true }
  },
  {
    name: 'timeline actions require their matching value kind',
    schemaId: `${SCHEMA_BASE}/timeline.schema.json`,
    value: {
      ...fixtureValues.get('timeline-level.json'),
      events: fixtureValues
        .get('timeline-level.json')
        .events.map((event, index) =>
          index === 1 ? { ...event, value: { kind: 'text', text: 'loud' } } : event
        )
    }
  }
];

for (const invalid of invalidCases) {
  const validate = ajv.getSchema(invalid.schemaId);
  assert(validate, `Schema should be registered for negative case: ${invalid.schemaId}`);
  assert.equal(validate(invalid.value), false, `${invalid.name} should be rejected`);
}

console.log(
  `Protocol schema validation passed: ${fixtures.length} fixtures accepted and ${invalidCases.length} invalid cases rejected.`
);
