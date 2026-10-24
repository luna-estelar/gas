// Connector configuration: schema, defaults, and the hand-written validator the
// renderer calls instead of compiling the schema.

import type {
  ConnectorConfig,
  ConnectorConfigProblem,
  ConnectorConfigSchema,
  ConnectorConfigValidation
} from '@luna-estelar/gas/protocol';
import { ConnectorError } from '@luna-estelar/gas/protocol';

export type MagentaRt2PromptConfig = {
  /** Weight of the global prompt (description, key, tempo) against track prompts. */
  readonly globalWeight: number;
  /** Weight of a track at level 1. */
  readonly trackWeight: number;
};

export type MagentaRt2GenerationConfig = {
  /** Sampling temperature; the engine's own default when omitted. */
  readonly temperature?: number;
  readonly topK?: number;
};

export type MagentaRt2ConnectorConfig = {
  readonly prompt: MagentaRt2PromptConfig;
  readonly generation: MagentaRt2GenerationConfig;
  /** How long to wait for the bridge to connect, greet and start. */
  readonly connectTimeoutSeconds: number;
};

type NumberRule = {
  readonly minimum: number;
  readonly maximum: number;
  readonly integer?: true;
};

const RULES = {
  globalWeight: { minimum: 0, maximum: 10 },
  trackWeight: { minimum: 0, maximum: 10 },
  temperature: { minimum: 0, maximum: 4 },
  topK: { minimum: 1, maximum: 1024, integer: true },
  connectTimeoutSeconds: { minimum: 1, maximum: 120 }
} as const satisfies Record<string, NumberRule>;

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

function numberSchema(rule: NumberRule): Record<string, unknown> {
  return {
    type: rule.integer ? 'integer' : 'number',
    minimum: rule.minimum,
    maximum: rule.maximum
  };
}

export const MAGENTA_RT2_CONFIG_SCHEMA: ConnectorConfigSchema = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Magenta RT2 connector configuration',
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: {
      type: 'object',
      additionalProperties: false,
      properties: {
        globalWeight: numberSchema(RULES.globalWeight),
        trackWeight: numberSchema(RULES.trackWeight)
      }
    },
    generation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        temperature: numberSchema(RULES.temperature),
        topK: numberSchema(RULES.topK)
      }
    },
    connectTimeoutSeconds: numberSchema(RULES.connectTimeoutSeconds)
  }
}) as ConnectorConfigSchema;

export const DEFAULT_MAGENTA_RT2_CONFIG: ConnectorConfig = deepFreeze({
  prompt: { globalWeight: 1, trackWeight: 1 },
  generation: {},
  connectTimeoutSeconds: 10
});

const MESSAGES = {
  'wrong-type': 'The value has the wrong type.',
  'out-of-range': 'The value is outside the allowed range.',
  'unknown-member': 'The connector does not recognise this member.'
} as const;

function problem(path: string, code: keyof typeof MESSAGES): ConnectorConfigProblem {
  return Object.freeze({ path, code, message: MESSAGES[code] });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkNumber(
  value: unknown,
  rule: NumberRule,
  path: string,
  problems: ConnectorConfigProblem[]
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push(problem(path, 'wrong-type'));
  } else if (rule.integer && !Number.isInteger(value)) {
    problems.push(problem(path, 'wrong-type'));
  } else if (value < rule.minimum || value > rule.maximum) {
    problems.push(problem(path, 'out-of-range'));
  }
}

function checkGroup(
  value: unknown,
  path: string,
  rules: Record<string, NumberRule>,
  problems: ConnectorConfigProblem[]
): void {
  if (!isObject(value)) {
    problems.push(problem(path, 'wrong-type'));
    return;
  }
  for (const [key, member] of Object.entries(value)) {
    const rule = rules[key];
    if (rule === undefined) problems.push(problem(`${path}/${key}`, 'unknown-member'));
    else checkNumber(member, rule, `${path}/${key}`, problems);
  }
}

/** Every problem with a configuration at once; `ok` when there are none. */
export function validateMagentaRt2Config(config: ConnectorConfig): ConnectorConfigValidation {
  const problems: ConnectorConfigProblem[] = [];
  if (!isObject(config)) {
    return { ok: false, problems: [problem('', 'wrong-type')] };
  }
  for (const [key, value] of Object.entries(config)) {
    if (key === 'prompt') {
      checkGroup(value, '/prompt', RULES_PROMPT, problems);
    } else if (key === 'generation') {
      checkGroup(value, '/generation', RULES_GENERATION, problems);
    } else if (key === 'connectTimeoutSeconds') {
      checkNumber(value, RULES.connectTimeoutSeconds, '/connectTimeoutSeconds', problems);
    } else {
      problems.push(problem(`/${key}`, 'unknown-member'));
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

const RULES_PROMPT: Record<string, NumberRule> = {
  globalWeight: RULES.globalWeight,
  trackWeight: RULES.trackWeight
};
const RULES_GENERATION: Record<string, NumberRule> = {
  temperature: RULES.temperature,
  topK: RULES.topK
};

/** Fills defaults into a configuration already known to be valid. */
export function resolveMagentaRt2Config(config: ConnectorConfig): MagentaRt2ConnectorConfig {
  const defaults = DEFAULT_MAGENTA_RT2_CONFIG as unknown as MagentaRt2ConnectorConfig;
  const candidate = config as Partial<{
    prompt: Partial<MagentaRt2PromptConfig>;
    generation: MagentaRt2GenerationConfig;
    connectTimeoutSeconds: number;
  }>;
  return deepFreeze({
    prompt: { ...defaults.prompt, ...candidate.prompt },
    generation: { ...candidate.generation },
    connectTimeoutSeconds: candidate.connectTimeoutSeconds ?? defaults.connectTimeoutSeconds
  });
}

export function validateAndResolveMagentaRt2Config(
  config: ConnectorConfig
): MagentaRt2ConnectorConfig {
  if (!validateMagentaRt2Config(config).ok) {
    throw new ConnectorError({
      code: 'magenta-rt2-invalid-configuration',
      reason: 'internal',
      retryable: false
    });
  }
  return resolveMagentaRt2Config(config);
}
