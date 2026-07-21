// Connector configuration schema, defaults and typed reader. The renderer validates
// edits; the transport derives bpm and scale from timing and effective state.

import type {
  ConnectorConfig,
  ConnectorConfigSchema,
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
          default: 'per-track'
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
    strategy: 'per-track',
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
  return value === 'global-plus-tracks' ? 'global-plus-tracks' : 'per-track';
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

function invalidConfiguration(): never {
  throw new ConnectorError({
    code: 'lyria-invalid-configuration',
    reason: 'internal',
    retryable: false
  });
}

function requirePlainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidConfiguration();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidConfiguration();
  return value as Record<string, unknown>;
}

function requireKnownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) invalidConfiguration();
}

function optionalObject(
  value: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<string>
): Record<string, unknown> {
  const member = value[key];
  if (member === undefined) return {};
  const object = requirePlainObject(member);
  requireKnownKeys(object, allowed);
  return object;
}

function optionalFiniteNumber(
  value: Record<string, unknown>,
  key: string,
  options: {
    readonly minimum?: number;
    readonly maximum?: number;
    readonly exclusiveMinimum?: number;
    readonly integer?: boolean;
  }
): void {
  const member = value[key];
  if (member === undefined) return;
  if (typeof member !== 'number' || !Number.isFinite(member)) invalidConfiguration();
  if (options.integer === true && !Number.isInteger(member)) invalidConfiguration();
  if (options.minimum !== undefined && member < options.minimum) invalidConfiguration();
  if (options.maximum !== undefined && member > options.maximum) invalidConfiguration();
  if (options.exclusiveMinimum !== undefined && member <= options.exclusiveMinimum) {
    invalidConfiguration();
  }
}

function optionalBooleanMember(value: Record<string, unknown>, key: string): void {
  const member = value[key];
  if (member !== undefined && typeof member !== 'boolean') invalidConfiguration();
}

/**
 * Validate the same partial JSON surface advertised by `LYRIA_CONFIG_SCHEMA`,
 * then resolve omitted members to the connector defaults. Renderer callers
 * arrive pre-validated; this protects direct Connector users without adding a
 * second schema-engine dependency to the model boundary.
 */
export function validateAndResolveLyriaConfig(config: ConnectorConfig): LyriaConnectorConfig {
  const root = requirePlainObject(config);
  requireKnownKeys(root, ROOT_KEYS);
  const prompt = optionalObject(root, 'prompt', PROMPT_KEYS);
  const generation = optionalObject(root, 'generation', GENERATION_KEYS);

  if (
    prompt.strategy !== undefined &&
    prompt.strategy !== 'per-track' &&
    prompt.strategy !== 'global-plus-tracks'
  ) {
    invalidConfiguration();
  }
  optionalFiniteNumber(prompt, 'trackWeight', { exclusiveMinimum: 0 });
  optionalFiniteNumber(prompt, 'globalWeight', { exclusiveMinimum: 0 });
  optionalFiniteNumber(prompt, 'minimumPositiveWeight', { exclusiveMinimum: 0 });
  optionalFiniteNumber(prompt, 'transitionDurationMs', { minimum: 0, integer: true });
  optionalFiniteNumber(prompt, 'transitionSteps', { minimum: 1, integer: true });

  optionalFiniteNumber(generation, 'temperature', { minimum: 0, maximum: 3 });
  optionalFiniteNumber(generation, 'guidance', { minimum: 0, maximum: 6 });
  optionalFiniteNumber(generation, 'topK', { minimum: 1, maximum: 1000, integer: true });
  if (
    generation.mode !== undefined &&
    generation.mode !== 'quality' &&
    generation.mode !== 'diversity'
  ) {
    invalidConfiguration();
  }
  optionalBooleanMember(generation, 'muteBass');
  optionalBooleanMember(generation, 'muteDrums');
  optionalBooleanMember(generation, 'onlyBassAndDrums');
  optionalFiniteNumber(generation, 'seed', {
    minimum: 0,
    maximum: 2147483647,
    integer: true
  });
  optionalFiniteNumber(generation, 'density', { minimum: 0, maximum: 1 });
  optionalFiniteNumber(generation, 'brightness', { minimum: 0, maximum: 1 });

  return deepFreeze(resolveLyriaConfig(config));
}
