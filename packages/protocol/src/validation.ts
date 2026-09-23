// Canonical protocol validation. The timeline validator is precompiled by
// `scripts/build-validators.mjs` rather than built here: browsers run these
// packages under a Content Security Policy without 'unsafe-eval', and AJV
// compiles its validators with `new Function`. Generating the validator at
// build time keeps the structural gate, costs nothing at import, and leaves
// AJV's compiler out of every bundle.
import {
  validateTimeline,
  type GeneratedValidationError
} from '../generated/timeline-validator.mjs';
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

export function validateTimelinePayload(value: unknown): ProtocolValidationResult<Timeline> {
  if (validateTimeline(value)) {
    // The generated validator reports a boolean rather than a type predicate;
    // passing the timeline schema is what makes the value a Timeline.
    return Object.freeze({ ok: true, value: value as Timeline });
  }
  return Object.freeze({
    ok: false,
    issues: Object.freeze((validateTimeline.errors ?? []).map(sanitizeIssue))
  });
}

function sanitizeIssue(error: GeneratedValidationError): ProtocolValidationIssue {
  return Object.freeze({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? ''
  });
}
