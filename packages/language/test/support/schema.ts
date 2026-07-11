import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaRoot = path.resolve(here, '../../../protocol/schemas/1.0');
const TIMELINE_SCHEMA_ID = 'https://gas.luna-estelar.com/protocol/1.0/timeline.schema.json';

export function loadTimelineValidator(): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of readdirSync(schemaRoot).filter((entry) => entry.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(path.join(schemaRoot, file), 'utf8')));
  }
  const validate = ajv.getSchema(TIMELINE_SCHEMA_ID);
  if (validate === undefined) {
    throw new Error(`Timeline schema not registered: ${TIMELINE_SCHEMA_ID}`);
  }
  return validate;
}
