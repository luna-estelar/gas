import {
  Ajv2020,
  type ErrorObject,
  type SchemaObject,
  type ValidateFunction
} from 'ajv/dist/2020.js';
import addFormatsImport, { type FormatsPlugin } from 'ajv-formats';
import capabilitiesSchema from '@luna-estelar/gas-protocol/schemas/1.0/capabilities.schema.json' with { type: 'json' };
import commandsSchema from '@luna-estelar/gas-protocol/schemas/1.0/commands.schema.json' with { type: 'json' };
import commonSchema from '@luna-estelar/gas-protocol/schemas/1.0/common.schema.json' with { type: 'json' };
import configSchema from '@luna-estelar/gas-protocol/schemas/1.0/config.schema.json' with { type: 'json' };
import diagnosticsSchema from '@luna-estelar/gas-protocol/schemas/1.0/diagnostics.schema.json' with { type: 'json' };
import rendererSchema from '@luna-estelar/gas-protocol/schemas/1.0/renderer.schema.json' with { type: 'json' };
import resourcesSchema from '@luna-estelar/gas-protocol/schemas/1.0/resources.schema.json' with { type: 'json' };
import sessionSchema from '@luna-estelar/gas-protocol/schemas/1.0/session.schema.json' with { type: 'json' };
import stateSchema from '@luna-estelar/gas-protocol/schemas/1.0/state.schema.json' with { type: 'json' };
import timelineSchema from '@luna-estelar/gas-protocol/schemas/1.0/timeline.schema.json' with { type: 'json' };
import type { Timeline } from './timeline.js';

const SCHEMA_BASE = 'https://gas.luna-estelar.com/protocol/1.0';

export const PROTOCOL_SCHEMA_IDS = Object.freeze({
  capabilities: `${SCHEMA_BASE}/capabilities.schema.json`,
  commands: `${SCHEMA_BASE}/commands.schema.json`,
  common: `${SCHEMA_BASE}/common.schema.json`,
  config: `${SCHEMA_BASE}/config.schema.json`,
  diagnostics: `${SCHEMA_BASE}/diagnostics.schema.json`,
  renderer: `${SCHEMA_BASE}/renderer.schema.json`,
  resources: `${SCHEMA_BASE}/resources.schema.json`,
  session: `${SCHEMA_BASE}/session.schema.json`,
  state: `${SCHEMA_BASE}/state.schema.json`,
  timeline: `${SCHEMA_BASE}/timeline.schema.json`
} as const);

export interface ProtocolValidationIssue {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly message: string;
}

export type ProtocolValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ProtocolValidationIssue[] };

const addFormats = addFormatsImport as unknown as FormatsPlugin;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

for (const schema of [
  commonSchema,
  resourcesSchema,
  timelineSchema,
  capabilitiesSchema,
  commandsSchema,
  stateSchema,
  diagnosticsSchema,
  configSchema,
  rendererSchema,
  sessionSchema
]) {
  ajv.addSchema(schema as SchemaObject);
}

const validateTimeline = requireValidator<Timeline>(PROTOCOL_SCHEMA_IDS.timeline);

export function validateTimelinePayload(value: unknown): ProtocolValidationResult<Timeline> {
  if (validateTimeline(value)) {
    return Object.freeze({ ok: true, value });
  }
  return Object.freeze({
    ok: false,
    issues: Object.freeze((validateTimeline.errors ?? []).map(sanitizeIssue))
  });
}

function requireValidator<T>(schemaId: string): ValidateFunction<T> {
  const validate = ajv.getSchema<T>(schemaId);
  if (validate === undefined) {
    throw new Error(`Protocol schema is not registered: ${schemaId}`);
  }
  return validate;
}

function sanitizeIssue(error: ErrorObject): ProtocolValidationIssue {
  return Object.freeze({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? ''
  });
}
