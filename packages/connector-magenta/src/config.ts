// Connector configuration schema, defaults, typed reader and the connector-owned
// validator the Renderer calls instead of compiling the schema. Generation
// defaults are the ones the official Magenta RealTime 2 engine ships with.

import type {
  ConnectorConfig,
  ConnectorConfigProblem,
  ConnectorConfigSchema,
  ConnectorConfigValidation,
  JsonObject,
  JsonValue
} from '@luna-estelar/gas-protocol';
import { ConnectorError } from '@luna-estelar/gas-protocol';

export type MagentaPromptStrategy = 'per-track' | 'global-plus-tracks';

export type MagentaPromptConfig = {
  readonly strategy: MagentaPromptStrategy;
  readonly trackWeight: number;
  readonly globalWeight: number;
  readonly minimumPositiveWeight: number;
  readonly describeTempo: boolean;
  readonly describeKey: boolean;
};

export type MagentaDrumMode = 'auto' | 'on' | 'off';

export type MagentaGenerationConfig = {
  readonly temperature: number;
  readonly topK: number;
  readonly styleGuidance: number;
  readonly notesGuidance: number;
  readonly drums: MagentaDrumMode;
};

export type MagentaConnectorConfig = {
  readonly prompt: MagentaPromptConfig;
  readonly generation: MagentaGenerationConfig;
};

/** Recursively freeze a plain JSON structure and return the same reference. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const member of Object.values(value as Record<string, unknown>)) {
      deepFreeze(member);
    }
    Object.freeze(value);
  }
  return value;
}

export const MAGENTA_CONFIG_SCHEMA: ConnectorConfigSchema = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Magenta RealTime connector configuration',
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: {
      type: 'object',
      additionalProperties: false,
      description:
        'How authored intent becomes weighted style prompts. The bridge blends the prompt ' +
        'embeddings by normalized weight, so weights set relative influence, not loudness.',
      properties: {
        strategy: {
          description:
            'Whether global mood folds into every track prompt (per-track) or rides in its own ' +
            'prompt alongside the tracks (global-plus-tracks).',
          enum: ['per-track', 'global-plus-tracks'],
          default: 'global-plus-tracks'
        },
        trackWeight: {
          description: 'Base influence of a track prompt before its level scales it.',
          type: 'number',
          exclusiveMinimum: 0,
          default: 1
        },
        globalWeight: {
          description: 'Influence of the standalone global prompt in global-plus-tracks.',
          type: 'number',
          exclusiveMinimum: 0,
          default: 0.8
        },
        minimumPositiveWeight: {
          description: 'Floor for any contributing track so a quiet part still colors the mix.',
          type: 'number',
          exclusiveMinimum: 0,
          default: 0.05
        },
        describeTempo: {
          description:
            'Describe the tempo in the global prompt. The model has no tempo control, so words ' +
            'are the only way to ask for one.',
          type: 'boolean',
          default: true
        },
        describeKey: {
          description: 'Describe the key in the global prompt, alongside any notes.',
          type: 'boolean',
          default: true
        }
      }
    },
    generation: {
      type: 'object',
      additionalProperties: false,
      description: 'Sampling settings the bridge passes to Magenta RealTime 2.',
      properties: {
        temperature: {
          description: 'Higher values wander further from the prompt.',
          type: 'number',
          minimum: 0,
          maximum: 4,
          default: 1
        },
        topK: {
          description: 'How many candidate tokens each step samples from.',
          type: 'integer',
          minimum: 1,
          maximum: 1024,
          default: 100
        },
        styleGuidance: {
          description: 'How firmly generation follows the style prompts.',
          type: 'number',
          minimum: -1,
          maximum: 7,
          default: 3
        },
        notesGuidance: {
          description: 'How firmly generation follows the pitches from notes and motif.',
          type: 'number',
          minimum: -1,
          maximum: 7,
          default: 5
        },
        drums: {
          description: 'Let the model decide (auto), ask for drums (on) or hold them back (off).',
          enum: ['auto', 'on', 'off'],
          default: 'auto'
        }
      }
    }
  }
});

export const DEFAULT_MAGENTA_CONFIG = deepFreeze({
  prompt: {
    strategy: 'global-plus-tracks',
    trackWeight: 1,
    globalWeight: 0.8,
    minimumPositiveWeight: 0.05,
    describeTempo: true,
    describeKey: true
  },
  generation: {
    temperature: 1,
    topK: 100,
    styleGuidance: 3,
    notesGuidance: 5,
    drums: 'auto'
  }
} as const) satisfies ConnectorConfig;

function asObject(value: JsonValue | undefined): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

function asNumber(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function asBoolean(value: JsonValue | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStrategy(value: JsonValue | undefined): MagentaPromptStrategy {
  return value === 'per-track' ? 'per-track' : 'global-plus-tracks';
}

function asDrums(value: JsonValue | undefined): MagentaDrumMode {
  return value === 'on' || value === 'off' ? value : 'auto';
}

/** Read validated connector settings, applying defaults for missing fields. */
export function resolveMagentaConfig(config: ConnectorConfig): MagentaConnectorConfig {
  const prompt = asObject(config.prompt);
  const generation = asObject(config.generation);
  const defaults = DEFAULT_MAGENTA_CONFIG;

  return {
    prompt: {
      strategy: asStrategy(prompt.strategy),
      trackWeight: asNumber(prompt.trackWeight, defaults.prompt.trackWeight),
      globalWeight: asNumber(prompt.globalWeight, defaults.prompt.globalWeight),
      minimumPositiveWeight: asNumber(
        prompt.minimumPositiveWeight,
        defaults.prompt.minimumPositiveWeight
      ),
      describeTempo: asBoolean(prompt.describeTempo, defaults.prompt.describeTempo),
      describeKey: asBoolean(prompt.describeKey, defaults.prompt.describeKey)
    },
    generation: {
      temperature: asNumber(generation.temperature, defaults.generation.temperature),
      topK: asNumber(generation.topK, defaults.generation.topK),
      styleGuidance: asNumber(generation.styleGuidance, defaults.generation.styleGuidance),
      notesGuidance: asNumber(generation.notesGuidance, defaults.generation.notesGuidance),
      drums: asDrums(generation.drums)
    }
  };
}

const ROOT_KEYS = new Set(['prompt', 'generation']);
const PROMPT_KEYS = new Set([
  'strategy',
  'trackWeight',
  'globalWeight',
  'minimumPositiveWeight',
  'describeTempo',
  'describeKey'
]);
const GENERATION_KEYS = new Set(['temperature', 'topK', 'styleGuidance', 'notesGuidance', 'drums']);

const PROMPT_STRATEGIES = ['per-track', 'global-plus-tracks'];
const DRUM_MODES = ['auto', 'on', 'off'];

/**
 * Collects every problem instead of stopping at the first, so a host editing
 * several members at once learns about all of them. Messages are built from the
 * rule's own bounds and never from the value under inspection.
 */
interface ProblemSink {
  readonly problems: ConnectorConfigProblem[];
}

type ProblemCode = 'wrong-type' | 'out-of-range' | 'not-allowed' | 'unknown-member';

function record(sink: ProblemSink, path: string, code: ProblemCode, message: string): void {
  sink.problems.push(Object.freeze({ path, code, message }));
}

interface NumberRule {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly integer?: boolean;
}

function rangeMessage(rule: NumberRule): string {
  const bounds: string[] = [];
  if (rule.exclusiveMinimum !== undefined) bounds.push(`greater than ${rule.exclusiveMinimum}`);
  if (rule.minimum !== undefined) bounds.push(`at least ${rule.minimum}`);
  if (rule.maximum !== undefined) bounds.push(`at most ${rule.maximum}`);
  return `The value must be ${bounds.join(' and ')}.`;
}

function plainObject(
  sink: ProblemSink,
  path: string,
  value: unknown
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    record(sink, path, 'wrong-type', 'The value must be a JSON object.');
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    record(sink, path, 'wrong-type', 'The value must be a plain JSON object.');
    return undefined;
  }
  return value as Record<string, unknown>;
}

function knownKeys(
  sink: ProblemSink,
  path: string,
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>
): void {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    record(
      sink,
      `${path}/${key}`,
      'unknown-member',
      'This member is not part of the Magenta configuration.'
    );
  }
}

/** An absent member is legal; a present one must be a plain object with known keys. */
function section(
  sink: ProblemSink,
  path: string,
  value: unknown,
  allowed: ReadonlySet<string>
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const object = plainObject(sink, path, value);
  if (object === undefined) return undefined;
  knownKeys(sink, path, object, allowed);
  return object;
}

function number(
  sink: ProblemSink,
  path: string,
  value: Record<string, unknown>,
  key: string,
  rule: NumberRule
): void {
  const member = value[key];
  if (member === undefined) return;
  const memberPath = `${path}/${key}`;
  if (typeof member !== 'number' || !Number.isFinite(member)) {
    record(sink, memberPath, 'wrong-type', 'The value must be a finite number.');
    return;
  }
  if (rule.integer === true && !Number.isInteger(member)) {
    record(sink, memberPath, 'wrong-type', 'The value must be a whole number.');
    return;
  }
  const low = rule.minimum !== undefined && member < rule.minimum;
  const high = rule.maximum !== undefined && member > rule.maximum;
  const exclusive = rule.exclusiveMinimum !== undefined && member <= rule.exclusiveMinimum;
  if (low || high || exclusive) record(sink, memberPath, 'out-of-range', rangeMessage(rule));
}

function boolean(
  sink: ProblemSink,
  path: string,
  value: Record<string, unknown>,
  key: string
): void {
  const member = value[key];
  if (member === undefined || typeof member === 'boolean') return;
  record(sink, `${path}/${key}`, 'wrong-type', 'The value must be true or false.');
}

function choice(
  sink: ProblemSink,
  path: string,
  value: Record<string, unknown>,
  key: string,
  allowed: readonly string[]
): void {
  const member = value[key];
  if (member === undefined) return;
  if (typeof member === 'string' && allowed.includes(member)) return;
  record(sink, `${path}/${key}`, 'not-allowed', `The value must be one of: ${allowed.join(', ')}.`);
}

/**
 * Check the same partial JSON surface advertised by `MAGENTA_CONFIG_SCHEMA`, by
 * hand, for the same reason as the Lyria connector: compiling the schema would
 * generate code at runtime. Rejects non-finite numbers and non-plain objects,
 * which could never round-trip as JSON.
 */
function collectProblems(config: ConnectorConfig): readonly ConnectorConfigProblem[] {
  const sink: ProblemSink = { problems: [] };
  const root = plainObject(sink, '', config);
  if (root === undefined) return sink.problems;
  knownKeys(sink, '', root, ROOT_KEYS);

  const prompt = section(sink, '/prompt', root.prompt, PROMPT_KEYS);
  if (prompt !== undefined) {
    choice(sink, '/prompt', prompt, 'strategy', PROMPT_STRATEGIES);
    number(sink, '/prompt', prompt, 'trackWeight', { exclusiveMinimum: 0 });
    number(sink, '/prompt', prompt, 'globalWeight', { exclusiveMinimum: 0 });
    number(sink, '/prompt', prompt, 'minimumPositiveWeight', { exclusiveMinimum: 0 });
    boolean(sink, '/prompt', prompt, 'describeTempo');
    boolean(sink, '/prompt', prompt, 'describeKey');
  }

  const generation = section(sink, '/generation', root.generation, GENERATION_KEYS);
  if (generation !== undefined) {
    number(sink, '/generation', generation, 'temperature', { minimum: 0, maximum: 4 });
    number(sink, '/generation', generation, 'topK', { minimum: 1, maximum: 1024, integer: true });
    number(sink, '/generation', generation, 'styleGuidance', { minimum: -1, maximum: 7 });
    number(sink, '/generation', generation, 'notesGuidance', { minimum: -1, maximum: 7 });
    choice(sink, '/generation', generation, 'drums', DRUM_MODES);
  }

  return sink.problems;
}

const CONFIG_OK: ConnectorConfigValidation = Object.freeze({ ok: true });

/** The `Connector.validateConfig` implementation: reports problems without throwing. */
export function validateMagentaConfig(config: ConnectorConfig): ConnectorConfigValidation {
  const problems = collectProblems(config);
  if (problems.length === 0) return CONFIG_OK;
  return Object.freeze({ ok: false, problems: Object.freeze(problems) });
}

/** Validate, then resolve omitted members to the connector defaults. */
export function validateAndResolveMagentaConfig(config: ConnectorConfig): MagentaConnectorConfig {
  if (collectProblems(config).length > 0) {
    throw new ConnectorError({
      code: 'magenta-invalid-configuration',
      reason: 'internal',
      retryable: false
    });
  }
  return deepFreeze(resolveMagentaConfig(config));
}
