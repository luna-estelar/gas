import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsImport, { type FormatsPlugin } from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { createSession, type CompileResult, type SessionState } from '../packages/api/src/index.js';
import {
  createLyriaConnector,
  LYRIA_CAPABILITIES,
  LYRIA_CONFIG_SCHEMA,
  DEFAULT_LYRIA_CONFIG
} from '../packages/connector-lyria/src/index.js';
import {
  applyCommand,
  createInputState,
  effectiveStateAt,
  sectionInstanceAt,
  validateTimeline,
  type CommandFailure,
  type CommandWarning,
  type TimelineProblem
} from '../packages/core/src/index.js';
import {
  compileSource,
  type GasDiagnostic,
  type Timeline
} from '../packages/language/src/index.js';
import type {
  CommandFailure as ProtocolCommandFailure,
  CommandWarning as ProtocolCommandWarning,
  CompileResult as ProtocolCompileResult,
  GasDiagnostic as ProtocolGasDiagnostic,
  RendererPositionEvent,
  RendererStatusEvent,
  SessionState as ProtocolSessionState,
  Timeline as ProtocolTimeline,
  TimelineProblem as ProtocolTimelineProblem
} from '../packages/protocol/src/index.js';
import { capabilitiesWith, createFakeWiring } from '../packages/api/test/support/fake-renderer.js';
import { readExample } from '../examples/support.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaRoot = path.resolve(here, '../packages/protocol/schemas/1.0');
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
      lifecycle: 'ready',
      playback: 'stopped',
      timelineLoaded: false,
      tracks: []
    } satisfies SessionState;

    expect(compiled.formatVersion).toEqual({ major: 1, minor: 0 });
    expect(diagnostics).toEqual([]);
    expect(compileResult.timeline).toBe(compiled);
    expect(failure.code).toBe('invalid-value');
    expect(warning.intent).toBe('motif');
    expect(problem.code).toBe('invalid-shape');
    expect(state.playback).toBe('stopped');
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
      { phase: 'active', capabilities: LYRIA_CAPABILITIES }
    );
    expect(warned.ok).toBe(true);
    if (!warned.ok) return;
    expect(
      schema(`${base}/diagnostics.schema.json#/$defs/CommandWarning`)(warned.warnings[0])
    ).toBe(true);

    const failed = applyCommand(
      loaded,
      { kind: 'playTrack', trackId: 'ghost' },
      { phase: 'active', capabilities: LYRIA_CAPABILITIES }
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

  it('validates actual state, capabilities, and connector configuration', async () => {
    const compiled = timeline();
    const input = createInputState(compiled);
    const effective = effectiveStateAt(
      input,
      { bar: 1 },
      {
        activeSection: sectionInstanceAt(compiled, { bar: 1 })
      }
    );

    expect(schema(`${base}/state.schema.json#/$defs/InputState`)(input)).toBe(true);
    expect(schema(`${base}/state.schema.json#/$defs/EffectiveState`)(effective)).toBe(true);
    expect(schema(`${base}/capabilities.schema.json`)(LYRIA_CAPABILITIES)).toBe(true);
    expect(
      schema(`${base}/config.schema.json#/$defs/ConnectorConfigSchema`)(LYRIA_CONFIG_SCHEMA)
    ).toBe(true);
    expect(schema(`${base}/config.schema.json#/$defs/ConnectorConfig`)(DEFAULT_LYRIA_CONFIG)).toBe(
      true
    );

    const description = await createLyriaConnector().describe();
    expect(schema(`${base}/renderer.schema.json#/$defs/ConnectorDescription`)(description)).toBe(
      true
    );
  });

  it('validates representative Renderer and API event payloads', async () => {
    const status: RendererStatusEvent = {
      lifecycle: 'ready',
      playback: 'running',
      runId: 'run.1',
      stream: 'streaming'
    };
    const position: RendererPositionEvent = {
      runId: 'run.1',
      position: { bar: 2 },
      seconds: 2,
      loopIteration: 1
    };
    expect(schema(`${base}/renderer.schema.json#/$defs/RendererStatusEvent`)(status)).toBe(true);
    expect(schema(`${base}/renderer.schema.json#/$defs/RendererPositionEvent`)(position)).toBe(
      true
    );

    const wiring = createFakeWiring(undefined, capabilitiesWith({ level: 'approximated' }));
    const session = await createSession(wiring);
    const states: unknown[] = [];
    const lifecycles: unknown[] = [];
    const warnings: unknown[] = [];
    session.on('state', (event) => states.push(event));
    session.on('lifecycle', (event) => lifecycles.push(event));
    session.on('warning', (event) => warnings.push(event));

    const compileResult = await session.compileSource(readExample('minimal'));
    expect(schema(`${base}/session.schema.json#/$defs/CompileResult`)(compileResult)).toBe(true);
    const compiled = compileResult.timeline;
    await session.loadTimeline(compiled);
    const commandResult = await session.setTrackLevel(compiled.tracks[0].trackId, 0.5);
    const liveResult = await session.submitLiveCommands('tempo 132');
    await session.play();
    wiring.current().emitStatus({
      lifecycle: 'ready',
      playback: 'running',
      runId: 'run-1',
      stream: 'streaming'
    });

    expect(schema(`${base}/session.schema.json#/$defs/CommandResult`)(commandResult)).toBe(true);
    expect(schema(`${base}/session.schema.json#/$defs/LiveCommandResult`)(liveResult)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(schema(`${base}/session.schema.json#/$defs/WarningEvent`)(warnings[0])).toBe(true);
    expect(lifecycles).toHaveLength(1);
    expect(schema(`${base}/session.schema.json#/$defs/LifecycleEvent`)(lifecycles[0])).toBe(true);
    for (const sessionState of states) {
      expect(schema(`${base}/session.schema.json#/$defs/SessionState`)(sessionState)).toBe(true);
    }
    await session.close();
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
