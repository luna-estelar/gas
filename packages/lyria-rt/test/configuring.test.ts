import { describe, expect, it } from 'vitest';
import { ConnectorError } from '@luna-estelar/gas/protocol';
import {
  DEFAULT_LYRIA_RT_CONFIG,
  LYRIA_RT_CONFIG_SCHEMA,
  resolveLyriaRtConfig
} from '../src/index.js';
import { validateAndResolveLyriaRtConfig, validateLyriaRtConfig } from '../src/config.js';

describe('Lyria RealTime connector configuration schema', () => {
  it('declares a Draft 2020-12 object schema with closed members', () => {
    expect(LYRIA_RT_CONFIG_SCHEMA.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(LYRIA_RT_CONFIG_SCHEMA.type).toBe('object');
    expect(LYRIA_RT_CONFIG_SCHEMA.additionalProperties).toBe(false);

    const properties = LYRIA_RT_CONFIG_SCHEMA.properties as Record<string, Record<string, unknown>>;
    expect(properties.prompt.additionalProperties).toBe(false);
    expect(properties.generation.additionalProperties).toBe(false);
  });

  it('keeps the advertised strategy default aligned with the runtime default', () => {
    const prompt = (
      LYRIA_RT_CONFIG_SCHEMA.properties as Record<
        string,
        { properties: Record<string, { default?: unknown }> }
      >
    ).prompt;
    expect(prompt.properties.strategy.default).toBe(DEFAULT_LYRIA_RT_CONFIG.prompt.strategy);
  });

  it('does not name bpm or scale (the transport derives them)', () => {
    const generation = (
      LYRIA_RT_CONFIG_SCHEMA.properties as Record<string, { properties: Record<string, unknown> }>
    ).generation.properties;
    expect(generation).not.toHaveProperty('bpm');
    expect(generation).not.toHaveProperty('scale');
  });

  it('deep-freezes the schema and the defaults', () => {
    expect(Object.isFrozen(LYRIA_RT_CONFIG_SCHEMA)).toBe(true);
    expect(Object.isFrozen(LYRIA_RT_CONFIG_SCHEMA.properties)).toBe(true);
    expect(Object.isFrozen(DEFAULT_LYRIA_RT_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_LYRIA_RT_CONFIG.prompt)).toBe(true);
    expect(Object.isFrozen(DEFAULT_LYRIA_RT_CONFIG.generation)).toBe(true);
  });
});

describe('Lyria RealTime connector defaults', () => {
  it('matches the settled prompt defaults', () => {
    expect(DEFAULT_LYRIA_RT_CONFIG.prompt).toEqual({
      strategy: 'global-plus-tracks',
      trackWeight: 1,
      globalWeight: 0.8,
      minimumPositiveWeight: 0.05,
      transitionDurationMs: 1500,
      transitionSteps: 3
    });
  });

  it('matches the settled generation defaults and omits the optional controls', () => {
    expect(DEFAULT_LYRIA_RT_CONFIG.generation).toEqual({
      temperature: 1.1,
      guidance: 4,
      topK: 40,
      mode: 'quality'
    });
    expect(DEFAULT_LYRIA_RT_CONFIG.generation).not.toHaveProperty('seed');
    expect(DEFAULT_LYRIA_RT_CONFIG.generation).not.toHaveProperty('density');
    expect(DEFAULT_LYRIA_RT_CONFIG.generation).not.toHaveProperty('brightness');
    expect(DEFAULT_LYRIA_RT_CONFIG.generation).not.toHaveProperty('muteBass');
    expect(DEFAULT_LYRIA_RT_CONFIG.generation).not.toHaveProperty('muteDrums');
    expect(DEFAULT_LYRIA_RT_CONFIG.generation).not.toHaveProperty('onlyBassAndDrums');
  });
});

describe('resolveLyriaRtConfig', () => {
  it('returns the full defaults for an empty configuration', () => {
    expect(resolveLyriaRtConfig({})).toEqual(DEFAULT_LYRIA_RT_CONFIG);
  });

  it('preserves an explicit per-track strategy', () => {
    expect(resolveLyriaRtConfig({ prompt: { strategy: 'per-track' } }).prompt.strategy).toBe(
      'per-track'
    );
  });

  it('fills gaps around partial configuration', () => {
    const resolved = resolveLyriaRtConfig({
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
    const withControls = resolveLyriaRtConfig({
      generation: { density: 0.3, brightness: 0.9, muteBass: true }
    });
    expect(withControls.generation.density).toBe(0.3);
    expect(withControls.generation.brightness).toBe(0.9);
    expect(withControls.generation.muteBass).toBe(true);
    expect(withControls.generation).not.toHaveProperty('seed');

    const withoutControls = resolveLyriaRtConfig({ generation: {} });
    expect(withoutControls.generation).not.toHaveProperty('density');
    expect(withoutControls.generation).not.toHaveProperty('brightness');
    expect(withoutControls.generation).not.toHaveProperty('muteBass');
  });
});

describe('validateAndResolveLyriaRtConfig', () => {
  it('validates partial direct-call input and freezes the resolved result', () => {
    const result = validateAndResolveLyriaRtConfig({
      prompt: { transitionDurationMs: 0, transitionSteps: 1 },
      generation: { seed: 47, density: 0.4 }
    });
    expect(result.prompt.strategy).toBe('global-plus-tracks');
    expect(result.generation.seed).toBe(47);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.generation)).toBe(true);
  });

  it.each([
    [{ unknown: true }, '/unknown', 'unknown-member'],
    [{ prompt: [] }, '/prompt', 'wrong-type'],
    [{ prompt: { trackWeight: 0 } }, '/prompt/trackWeight', 'out-of-range'],
    [{ generation: { mode: 'vocalization' } }, '/generation/mode', 'not-allowed']
  ] as const)('rejects schema-invalid direct input: %j', (config, path, code) => {
    expect(() => validateAndResolveLyriaRtConfig(config)).toThrow(ConnectorError);
    expect(validateLyriaRtConfig(config)).toMatchObject({
      ok: false,
      problems: [{ path, code }]
    });
  });
});

describe('validateLyriaRtConfig', () => {
  it('reports the root itself when the configuration is not an object', () => {
    // A non-object root has no members to inspect, so one problem is the whole answer.
    expect(validateLyriaRtConfig([] as unknown as Record<string, never>)).toMatchObject({
      ok: false,
      problems: [{ path: '', code: 'wrong-type' }]
    });
  });

  it('collects every problem rather than stopping at the first', () => {
    const result = validateLyriaRtConfig({
      unknown: 1,
      prompt: { trackWeight: -1, transitionSteps: 0 },
      generation: { guidance: 9, muteBass: 'yes' }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.path)).toEqual([
      '/unknown',
      '/prompt/trackWeight',
      '/prompt/transitionSteps',
      '/generation/guidance',
      '/generation/muteBass'
    ]);
    // Messages describe the rule, never the offending value.
    for (const problem of result.problems) {
      expect(problem.message).not.toMatch(/yes|-1/);
      expect(Object.isFrozen(problem)).toBe(true);
    }
  });

  it('names every unknown member, not just the first', () => {
    expect(validateLyriaRtConfig({ tempo: 1, key: 'C' })).toMatchObject({
      ok: false,
      problems: [
        { path: '/tempo', code: 'unknown-member' },
        { path: '/key', code: 'unknown-member' }
      ]
    });
  });
});
