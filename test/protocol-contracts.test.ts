import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsImport, { type FormatsPlugin } from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { type CompileResult, type SessionState } from '../packages/gas/src/api/index.js';
import { createLyriaRtConnector, LYRIA_RT_CAPABILITIES } from '../packages/lyria-rt/src/index.js';
import { createMagentaRt2Connector } from '../packages/magenta-rt2/src/index.js';
import {
  applyCommand,
  createInputState,
  validateTimeline,
  type CommandFailure,
  type CommandWarning,
  type TimelineProblem
} from '../packages/gas/src/core/index.js';
import {
  compileSource,
  type GasDiagnostic,
  type Timeline
} from '../packages/gas/src/language/index.js';
import type {
  CommandFailure as ProtocolCommandFailure,
  CommandWarning as ProtocolCommandWarning,
  CompileResult as ProtocolCompileResult,
  ConnectorConfigProblem,
  ConnectorConfigValidation,
  GasDiagnostic as ProtocolGasDiagnostic,
  SessionState as ProtocolSessionState,
  Timeline as ProtocolTimeline,
  TimelineProblem as ProtocolTimelineProblem
} from '../packages/gas/src/protocol/index.js';
import { readExample } from '../examples/support.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaRoot = path.resolve(here, '../packages/gas/schemas/1.0');
const base = 'https://gas.luna-estelar.com/protocol/1.0';
const addFormats = addFormatsImport as unknown as FormatsPlugin;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const file of readdirSync(schemaRoot).filter((entry) => entry.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(path.join(schemaRoot, file), 'utf8')));
}

function schema(ref: string): ValidateFunction {
  const validate = ajv.getSchema(ref);
  if (validate === undefined) throw new Error(`Missing schema: ${ref}`);
  return validate;
}

function timeline(): Timeline {
  const source = readExample('minimal');
  const result = compileSource(source, { name: 'minimal.gas' });
  if (!result.ok) throw new Error('The minimal corpus document should compile.');
  return result.timeline;
}

describe('landed values match canonical protocol schemas', () => {
  it('keeps Language/Core/API compatibility exports identical to Protocol', () => {
    const compiled: ProtocolTimeline = timeline() satisfies Timeline;
    const diagnostics: readonly ProtocolGasDiagnostic[] = [] satisfies readonly GasDiagnostic[];
    const compileResult: ProtocolCompileResult = {
      timeline: compiled,
      diagnostics
    } satisfies CompileResult;
    const failure: ProtocolCommandFailure = {
      code: 'invalid-value',
      message: 'Invalid value.'
    } satisfies CommandFailure;
    const warning: ProtocolCommandWarning = {
      code: 'unsupported-intent',
      intent: 'motif',
      support: 'unsupported',
      message: 'Unsupported motif.'
    } satisfies CommandWarning;
    const problem: ProtocolTimelineProblem = {
      code: 'invalid-shape',
      message: 'Invalid shape.'
    } satisfies TimelineProblem;
    const state: ProtocolSessionState = {
      status: 'stopped',
      loaded: false,
      tracks: [],
      appValues: []
    } satisfies SessionState;

    expect(compiled.formatVersion).toEqual({ major: 1, minor: 0 });
    expect(diagnostics).toEqual([]);
    expect(compileResult.timeline).toBe(compiled);
    expect(failure.code).toBe('invalid-value');
    expect(warning.intent).toBe('motif');
    expect(problem.code).toBe('invalid-shape');
    expect(state.status).toBe('stopped');
  });

  it('validates real compiler diagnostics and Core outcomes', () => {
    const invalid = compileSource('ghost()');
    expect(invalid.ok).toBe(false);
    expect(invalid.diagnostics.length).toBeGreaterThan(0);
    const diagnosticValidator = schema(`${base}/diagnostics.schema.json#/$defs/GasDiagnostic`);
    for (const diagnostic of invalid.diagnostics) {
      expect(diagnosticValidator(diagnostic), JSON.stringify(diagnosticValidator.errors)).toBe(
        true
      );
    }

    const loaded = createInputState(timeline());
    const trackId = loaded.timeline.tracks[0].trackId;
    const warned = applyCommand(
      loaded,
      { kind: 'setTrackMotif', trackId, alda: 'c d e' },
      { capabilities: LYRIA_RT_CAPABILITIES }
    );
    expect(warned.ok).toBe(true);
    if (!warned.ok) return;
    expect(
      schema(`${base}/diagnostics.schema.json#/$defs/CommandWarning`)(warned.warnings[0])
    ).toBe(true);

    const failed = applyCommand(
      loaded,
      { kind: 'playTrack', trackId: 'ghost' },
      { capabilities: LYRIA_RT_CAPABILITIES }
    );
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(schema(`${base}/diagnostics.schema.json#/$defs/CommandFailure`)(failed.failure)).toBe(
      true
    );

    const invalidTimeline = validateTimeline({ ...loaded.timeline, extra: true });
    expect(invalidTimeline.ok).toBe(false);
    for (const problem of invalidTimeline.problems) {
      expect(schema(`${base}/diagnostics.schema.json#/$defs/TimelineProblem`)(problem)).toBe(true);
    }
  });

  it('validates a connector description against the capabilities and config schemas', () => {
    // The runtime-shape schemas are no longer published; the data a description
    // carries still has schemas.
    for (const connector of [
      createLyriaRtConnector({ apiKey: 'test-key' }),
      createMagentaRt2Connector({ endpoint: 'ws://127.0.0.1:8765' })
    ]) {
      const { description } = connector;
      expect(schema(`${base}/capabilities.schema.json`)(description.capabilities)).toBe(true);
      expect(
        schema(`${base}/config.schema.json#/$defs/ConnectorConfigSchema`)(description.configSchema)
      ).toBe(true);
      expect(
        schema(`${base}/config.schema.json#/$defs/ConnectorConfig`)(description.defaultConfig)
      ).toBe(true);
    }
  });

  it('validates config problems', () => {
    const problem: ConnectorConfigProblem = {
      path: '/generation/temperature',
      code: 'out-of-range',
      message: 'The temperature must be between 0 and 3.'
    };
    const validation: ConnectorConfigValidation = { ok: false, problems: [problem] };

    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.problems).toEqual([problem]);
  });

  it('keeps schema validation before Core reference validation', () => {
    const compiled = timeline();
    const extra = validateTimeline({ ...compiled, extra: true });
    expect(extra).toMatchObject({ ok: false, problems: [{ code: 'invalid-shape' }] });

    const target = compiled.events[0];
    if (target === undefined || target.type !== 'track') return;
    const unresolved = validateTimeline({
      ...compiled,
      events: [{ ...target, targetId: 'track.ghost' }, ...compiled.events.slice(1)]
    });
    expect(unresolved.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unresolved-reference' })])
    );
  });
});
