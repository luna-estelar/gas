// Connector configuration schema, defaults, typed reader and the connector-owned
// validator the Renderer calls instead of compiling the schema. The transport
// derives bpm and scale from timing and effective state.

import type {
  ConnectorConfig,
  ConnectorConfigProblem,
  ConnectorConfigSchema,
  ConnectorConfigValidation,
  JsonObject,
  JsonValue
} from '@luna-estelar/gas-protocol';
import { ConnectorError } from '@luna-estelar/gas-protocol';

export type LyriaPromptStrategy = 'per-track' | 'global-plus-tracks';

export type LyriaPromptConfig = {
  readonly strategy: LyriaPromptStrategy;
  readonly trackWeight: number;
  readonly globalWeight: number;
  readonly minimumPositiveWeight: number;
  readonly transitionDurationMs: number;
  readonly transitionSteps: number;
};

export type LyriaGenerationMode = 'quality' | 'diversity';

export type LyriaGenerationConfig = {
  readonly temperature: number;
  readonly guidance: number;
  readonly topK: number;
  readonly mode: LyriaGenerationMode;
  readonly muteBass?: boolean;
  readonly muteDrums?: boolean;
  readonly onlyBassAndDrums?: boolean;
  readonly seed?: number;
  readonly density?: number;
  readonly brightness?: number;
};

export type LyriaConnectorConfig = {
  readonly prompt: LyriaPromptConfig;
  readonly generation: LyriaGenerationConfig;
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

export const LYRIA_CONFIG_SCHEMA: ConnectorConfigSchema = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Lyria connector configuration',
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: {
      type: 'object',
      additionalProperties: false,
      description:
        'How authored intent becomes weighted prompts. Lyria normalizes each weighted prompt ' +
        'set, so these weights set the relative influence between prompts, not absolute ' +
        'loudness. A transition of one step or zero duration is sent in a single move.',
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
        transitionDurationMs: {
          description: 'How long a prompt change crossfades, in milliseconds.',
          type: 'integer',
          minimum: 0,
          default: 1500
        },
        transitionSteps: {
          description: 'How many prompt sends make up a crossfade, including the final one.',
          type: 'integer',
          minimum: 1,
          default: 3
        }
      }
    },
    generation: {
      type: 'object',
      additionalProperties: false,
      description: 'Model generation settings sent to Lyria.',
      properties: {
        temperature: {
          description: 'Higher values wander further from the prompt.',
          type: 'number',
          minimum: 0,
          maximum: 3,
          default: 1.1
        },
        guidance: {
          description: 'How firmly generation follows the prompts.',
          type: 'number',
          minimum: 0,
          maximum: 6,
          default: 4
        },
        topK: {
          description: 'How many candidate tokens each step samples from.',
          type: 'integer',
          minimum: 1,
          maximum: 1000,
          default: 40
        },
        mode: {
          description: 'Bias generation toward polish (quality) or variety (diversity).',
          enum: ['quality', 'diversity'],
          default: 'quality'
        },
        muteBass: {
          description: 'Hold back the bass part.',
          type: 'boolean'
        },
        muteDrums: {
          description: 'Hold back the drum part.',
          type: 'boolean'
        },
        onlyBassAndDrums: {
          description: 'Generate only bass and drums.',
          type: 'boolean'
        },
        seed: {
          description: 'Fix the random seed for a repeatable take. Omit to let the model choose.',
          type: 'integer',
          minimum: 0,
          maximum: 2147483647
        },
        density: {
          description: 'How busy the arrangement is, from sparse (0) to dense (1).',
          type: 'number',
          minimum: 0,
          maximum: 1
        },
        brightness: {
          description: 'Tonal brightness, from dark (0) to bright (1).',
          type: 'number',
          minimum: 0,
          maximum: 1
        }
      }
    }
  }
});

export const DEFAULT_LYRIA_CONFIG = deepFreeze({
  prompt: {
    strategy: 'global-plus-tracks',
    trackWeight: 1,
    globalWeight: 0.8,
    minimumPositiveWeight: 0.05,
    transitionDurationMs: 1500,
    transitionSteps: 3
  },
  generation: {
    temperature: 1.1,
    guidance: 4,
    topK: 40,
    mode: 'quality'
  }
} as const) satisfies ConnectorConfig;

function asObject(value: JsonValue | undefined): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

function asNumber(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function optionalBoolean(value: JsonValue | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStrategy(value: JsonValue | undefined): LyriaPromptStrategy {
  return value === 'per-track' ? 'per-track' : 'global-plus-tracks';
}

function asMode(value: JsonValue | undefined): LyriaGenerationMode {
  return value === 'diversity' ? 'diversity' : 'quality';
}

function optionalNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Read validated connector settings, applying defaults for missing fields. */
export function resolveLyriaConfig(config: ConnectorConfig): LyriaConnectorConfig {
  const prompt = asObject(config.prompt);
  const generation = asObject(config.generation);
  const defaults = DEFAULT_LYRIA_CONFIG;

  const seed = optionalNumber(generation.seed);
  const density = optionalNumber(generation.density);
  const brightness = optionalNumber(generation.brightness);
  const muteBass = optionalBoolean(generation.muteBass);
  const muteDrums = optionalBoolean(generation.muteDrums);
  const onlyBassAndDrums = optionalBoolean(generation.onlyBassAndDrums);

  return {
    prompt: {
      strategy: asStrategy(prompt.strategy),
      trackWeight: asNumber(prompt.trackWeight, defaults.prompt.trackWeight),
      globalWeight: asNumber(prompt.globalWeight, defaults.prompt.globalWeight),
      minimumPositiveWeight: asNumber(
        prompt.minimumPositiveWeight,
        defaults.prompt.minimumPositiveWeight
      ),
      transitionDurationMs: asNumber(
        prompt.transitionDurationMs,
        defaults.prompt.transitionDurationMs
      ),
      transitionSteps: asNumber(prompt.transitionSteps, defaults.prompt.transitionSteps)
    },
    generation: {
      temperature: asNumber(generation.temperature, defaults.generation.temperature),
      guidance: asNumber(generation.guidance, defaults.generation.guidance),
      topK: asNumber(generation.topK, defaults.generation.topK),
      mode: asMode(generation.mode),
      ...(muteBass !== undefined ? { muteBass } : {}),
      ...(muteDrums !== undefined ? { muteDrums } : {}),
      ...(onlyBassAndDrums !== undefined ? { onlyBassAndDrums } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...(density !== undefined ? { density } : {}),
      ...(brightness !== undefined ? { brightness } : {})
    }
  };
}

const ROOT_KEYS = new Set(['prompt', 'generation']);
const PROMPT_KEYS = new Set([
  'strategy',
  'trackWeight',
  'globalWeight',
  'minimumPositiveWeight',
  'transitionDurationMs',
  'transitionSteps'
]);
const GENERATION_KEYS = new Set([
  'temperature',
  'guidance',
  'topK',
  'mode',
  'muteBass',
  'muteDrums',
  'onlyBassAndDrums',
  'seed',
  'density',
  'brightness'
]);

const PROMPT_STRATEGIES = ['per-track', 'global-plus-tracks'];
const GENERATION_MODES = ['quality', 'diversity'];

/**
 * Collects every problem instead of stopping at the first, so a host editing
 * several members at once learns about all of them. Messages are built from the
 * rule's own bounds and never from the value under inspection, so a caller's own
 * text can never ride back out through a problem.
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
      'This member is not part of the Lyria configuration.'
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
 * Check the same partial JSON surface advertised by `LYRIA_CONFIG_SCHEMA`, by
 * hand. The Renderer calls this through `Connector.validateConfig` rather than
 * compiling the schema, because compiling one generates code at runtime, which a
 * browser Content Security Policy without `'unsafe-eval'` blocks.
 *
 * Deliberately stricter than the schema in two places: a non-finite number is
 * rejected where JSON Schema's `number` accepts it, and a value whose prototype
 * is neither `Object.prototype` nor `null` is rejected where the schema has no
 * equivalent. Both reject input that could never round-trip as JSON.
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
    number(sink, '/prompt', prompt, 'transitionDurationMs', { minimum: 0, integer: true });
    number(sink, '/prompt', prompt, 'transitionSteps', { minimum: 1, integer: true });
  }

  const generation = section(sink, '/generation', root.generation, GENERATION_KEYS);
  if (generation !== undefined) {
    number(sink, '/generation', generation, 'temperature', { minimum: 0, maximum: 3 });
    number(sink, '/generation', generation, 'guidance', { minimum: 0, maximum: 6 });
    number(sink, '/generation', generation, 'topK', { minimum: 1, maximum: 1000, integer: true });
    choice(sink, '/generation', generation, 'mode', GENERATION_MODES);
    boolean(sink, '/generation', generation, 'muteBass');
    boolean(sink, '/generation', generation, 'muteDrums');
    boolean(sink, '/generation', generation, 'onlyBassAndDrums');
    number(sink, '/generation', generation, 'seed', {
      minimum: 0,
      maximum: 2147483647,
      integer: true
    });
    number(sink, '/generation', generation, 'density', { minimum: 0, maximum: 1 });
    number(sink, '/generation', generation, 'brightness', { minimum: 0, maximum: 1 });
  }

  return sink.problems;
}

const CONFIG_OK: ConnectorConfigValidation = Object.freeze({ ok: true });

/** The `Connector.validateConfig` implementation: reports problems without throwing. */
export function validateLyriaConfig(config: ConnectorConfig): ConnectorConfigValidation {
  const problems = collectProblems(config);
  if (problems.length === 0) return CONFIG_OK;
  return Object.freeze({ ok: false, problems: Object.freeze(problems) });
}

/**
 * Validate, then resolve omitted members to the connector defaults. Renderer
 * callers arrive pre-validated through {@link validateLyriaConfig}; this protects
 * direct Connector users, and collects every problem before failing so the throw
 * is not decided by member order.
 */
export function validateAndResolveLyriaConfig(config: ConnectorConfig): LyriaConnectorConfig {
  if (collectProblems(config).length > 0) {
    throw new ConnectorError({
      code: 'lyria-invalid-configuration',
      reason: 'internal',
      retryable: false
    });
  }
  return deepFreeze(resolveLyriaConfig(config));
}
