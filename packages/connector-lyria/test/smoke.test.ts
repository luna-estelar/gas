import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LYRIA_CONFIG,
  LYRIA_CONFIG_SCHEMA,
  LYRIA_SCALES,
  classifyKey,
  createLyriaConnector,
  createPromptTransition,
  packageName,
  resolveLyriaConfig,
  translatePrompts,
  version
} from '../src/index.js';

describe('@luna-estelar/gas-connector-lyria', () => {
  it('exposes package metadata', () => {
    expect(packageName).toBe('@luna-estelar/gas-connector-lyria');
    expect(version).toBe('0.1.0');
  });

  it('exposes the prompt-translation surface the transport stage consumes', () => {
    expect(typeof translatePrompts).toBe('function');
    expect(typeof classifyKey).toBe('function');
    expect(typeof resolveLyriaConfig).toBe('function');
    expect(typeof createPromptTransition).toBe('function');
    expect(typeof createLyriaConnector).toBe('function');
    expect(LYRIA_SCALES).toHaveLength(12);
    expect(LYRIA_CONFIG_SCHEMA.type).toBe('object');
    expect(DEFAULT_LYRIA_CONFIG.prompt.strategy).toBe('global-plus-tracks');
  });
});
