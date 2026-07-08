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
  ['audio-chunk.json', `${SCHEMA_BASE}/audio.schema.json#/$defs/AudioChunk`],
  ['audio-stream.json', `${SCHEMA_BASE}/audio.schema.json#/$defs/AudioStreamDescriptor`],
  ['capabilities.json', `${SCHEMA_BASE}/capabilities.schema.json`],
  ['compiler-diagnostic.json', `${SCHEMA_BASE}/diagnostics.schema.json#/$defs/CompilerDiagnostic`],
  ['config-schema.json', `${SCHEMA_BASE}/config.schema.json#/$defs/ConfigSchemaDescriptor`],
  ['config-snapshot.json', `${SCHEMA_BASE}/config.schema.json#/$defs/ConfigSnapshot`],
  ['renderer-failure.json', `${SCHEMA_BASE}/diagnostics.schema.json#/$defs/RendererFailure`],
  ['renderer-warning.json', `${SCHEMA_BASE}/diagnostics.schema.json#/$defs/RendererWarning`],
  ['timeline-finite.json', `${SCHEMA_BASE}/timeline.schema.json`],
  ['timeline-infinite.json', `${SCHEMA_BASE}/timeline.schema.json`],
  ['timeline-level.json', `${SCHEMA_BASE}/timeline.schema.json`],
  ['timeline-loop.json', `${SCHEMA_BASE}/timeline.schema.json`]
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

for (const [fixture, schemaId] of fixtureSchemas) {
  const validate = ajv.getSchema(schemaId);
  assert(validate, `Schema should be registered for ${fixture}: ${schemaId}`);
  const example = JSON.parse(await readFile(path.join(fixtureRoot, fixture), 'utf8'));
  assert(
    validate(example),
    `${fixture} should validate against ${schemaId}:\n${ajv.errorsText(validate.errors, { separator: '\n' })}`
  );
}

console.log(
  `Protocol schema validation passed: ${fixtures.length} fixtures validate against schemas/1.0.`
);
