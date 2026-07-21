import { describe, expect, it } from 'vitest';
import { ConnectorError } from '@luna-estelar/gas-protocol';
import { DEFAULT_LYRIA_CONFIG, LYRIA_CONFIG_SCHEMA, resolveLyriaConfig } from '../src/index.js';
import { validateAndResolveLyriaConfig } from '../src/config.js';

describe('Lyria connector configuration schema', () => {
  it('declares a Draft 2020-12 object schema with closed members', () => {
    expect(LYRIA_CONFIG_SCHEMA.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(LYRIA_CONFIG_SCHEMA.type).toBe('object');
    expect(LYRIA_CONFIG_SCHEMA.additionalProperties).toBe(false);

    const properties = LYRIA_CONFIG_SCHEMA.properties as Record<string, Record<string, unknown>>;
    expect(properties.prompt.additionalProperties).toBe(false);
    expect(properties.generation.additionalProperties).toBe(false);
  });

  it('documents that weights express relative influence, not loudness', () => {
    const promptSchema = (LYRIA_CONFIG_SCHEMA.properties as Record<string, { description: string }>)
      .prompt;
    expect(promptSchema.description).toMatch(/relative influence/i);
    expect(promptSchema.description).toMatch(/normalizes/i);
  });

  it('does not name bpm or scale (the transport derives them)', () => {
    const generation = (
      LYRIA_CONFIG_SCHEMA.properties as Record<string, { properties: Record<string, unknown> }>
    ).generation.properties;
    expect(generation).not.toHaveProperty('bpm');
    expect(generation).not.toHaveProperty('scale');
  });

  it('deep-freezes the schema and the defaults', () => {
    expect(Object.isFrozen(LYRIA_CONFIG_SCHEMA)).toBe(true);
    expect(Object.isFrozen(LYRIA_CONFIG_SCHEMA.properties)).toBe(true);
    expect(Object.isFrozen(DEFAULT_LYRIA_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_LYRIA_CONFIG.prompt)).toBe(true);
    expect(Object.isFrozen(DEFAULT_LYRIA_CONFIG.generation)).toBe(true);
  });
});

describe('Lyria connector defaults', () => {
  it('matches the settled prompt defaults', () => {
    expect(DEFAULT_LYRIA_CONFIG.prompt).toEqual({
      strategy: 'per-track',
      trackWeight: 1,
      globalWeight: 0.8,
      minimumPositiveWeight: 0.05,
      transitionDurationMs: 1500,
      transitionSteps: 3
    });
  });

  it('matches the settled generation defaults and omits the optional controls', () => {
    expect(DEFAULT_LYRIA_CONFIG.generation).toEqual({
      temperature: 1.1,
      guidance: 4,
      topK: 40,
      mode: 'quality'
    });
    expect(DEFAULT_LYRIA_CONFIG.generation).not.toHaveProperty('seed');
    expect(DEFAULT_LYRIA_CONFIG.generation).not.toHaveProperty('density');
    expect(DEFAULT_LYRIA_CONFIG.generation).not.toHaveProperty('brightness');
    expect(DEFAULT_LYRIA_CONFIG.generation).not.toHaveProperty('muteBass');
    expect(DEFAULT_LYRIA_CONFIG.generation).not.toHaveProperty('muteDrums');
    expect(DEFAULT_LYRIA_CONFIG.generation).not.toHaveProperty('onlyBassAndDrums');
  });
});

describe('resolveLyriaConfig', () => {
  it('returns the full defaults for an empty configuration', () => {
    expect(resolveLyriaConfig({})).toEqual(DEFAULT_LYRIA_CONFIG);
  });

  it('fills gaps around partial configuration', () => {
    const resolved = resolveLyriaConfig({
      prompt: { strategy: 'global-plus-tracks', trackWeight: 2 },
      generation: { temperature: 0.5, seed: 7 }
    });

    expect(resolved.prompt.strategy).toBe('global-plus-tracks');
    expect(resolved.prompt.trackWeight).toBe(2);
    expect(resolved.prompt.globalWeight).toBe(0.8);
    expect(resolved.generation.temperature).toBe(0.5);
    expect(resolved.generation.guidance).toBe(4);
    expect(resolved.generation.seed).toBe(7);
  });

  it('carries the optional generation controls only when present', () => {
    const withControls = resolveLyriaConfig({
      generation: { density: 0.3, brightness: 0.9, muteBass: true }
    });
    expect(withControls.generation.density).toBe(0.3);
    expect(withControls.generation.brightness).toBe(0.9);
    expect(withControls.generation.muteBass).toBe(true);
    expect(withControls.generation).not.toHaveProperty('seed');

    const withoutControls = resolveLyriaConfig({ generation: {} });
    expect(withoutControls.generation).not.toHaveProperty('density');
    expect(withoutControls.generation).not.toHaveProperty('brightness');
    expect(withoutControls.generation).not.toHaveProperty('muteBass');
  });
});

describe('validateAndResolveLyriaConfig', () => {
  it('validates partial direct-call input and freezes the resolved result', () => {
    const result = validateAndResolveLyriaConfig({
      prompt: { transitionDurationMs: 0, transitionSteps: 1 },
      generation: { seed: 47, density: 0.4 }
    });
    expect(result.prompt.strategy).toBe('per-track');
    expect(result.generation.seed).toBe(47);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.generation)).toBe(true);
  });

  it.each([
    { unknown: true },
    { prompt: [] },
    { prompt: { trackWeight: 0 } },
    { prompt: { transitionSteps: 1.5 } },
    { generation: { temperature: Number.NaN } },
    { generation: { topK: 1001 } },
    { generation: { seed: -1 } },
    { generation: { mode: 'vocalization' } }
  ])('rejects schema-invalid direct input: %j', (config) => {
    expect(() => validateAndResolveLyriaConfig(config)).toThrow(ConnectorError);
  });
});
