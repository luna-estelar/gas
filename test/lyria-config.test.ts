// Cross-boundary contract: the configuration the Lyria connector advertises must
// compile and validate under the exact AJV 2020 setup the Renderer runs. Root
// tests may compose package internals; package boundary tests may not.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LYRIA_CONFIG,
  LYRIA_CONFIG_SCHEMA
} from '../packages/connector-lyria/src/index.js';
import { applyMergePatch, compileConfigSchema } from '../packages/renderer/src/connector-config.js';

describe('Lyria configuration under the Renderer validator', () => {
  it('compiles the advertised schema and accepts the advertised defaults', () => {
    const validator = compileConfigSchema(LYRIA_CONFIG_SCHEMA);
    expect(validator.validate(DEFAULT_LYRIA_CONFIG)).toEqual([]);
  });

  it('rejects an unknown top-level member', () => {
    const validator = compileConfigSchema(LYRIA_CONFIG_SCHEMA);
    const problems = validator.validate(applyMergePatch(DEFAULT_LYRIA_CONFIG, { tempo: 120 }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects an unknown nested generation member', () => {
    const validator = compileConfigSchema(LYRIA_CONFIG_SCHEMA);
    const problems = validator.validate(
      applyMergePatch(DEFAULT_LYRIA_CONFIG, { generation: { scale: 'C_MAJOR_A_MINOR' } })
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects an out-of-range value', () => {
    const validator = compileConfigSchema(LYRIA_CONFIG_SCHEMA);
    const problems = validator.validate(
      applyMergePatch(DEFAULT_LYRIA_CONFIG, { generation: { temperature: 5 } })
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('accepts a merge patch that removes an optional control with null', () => {
    const validator = compileConfigSchema(LYRIA_CONFIG_SCHEMA);
    const withSeed = applyMergePatch(DEFAULT_LYRIA_CONFIG, { generation: { seed: 7 } });
    expect(validator.validate(withSeed)).toEqual([]);

    const withoutSeed = applyMergePatch(withSeed, { generation: { seed: null } });
    expect(validator.validate(withoutSeed)).toEqual([]);
    expect((withoutSeed.generation as Record<string, unknown>).seed).toBeUndefined();
  });
});
