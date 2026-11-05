import { createInputState } from '../../src/core/index.js';
import type {
  ConnectorConfig,
  ConnectorConfigProblem,
  ConnectorConfigSchema,
  ConnectorConfigValidation
} from '../../src/protocol/index.js';
import { describe, expect, it } from 'vitest';
import { createRenderer, RendererError, type RendererWarning } from '../../src/renderer/index.js';
import { FakeConnector } from '../../../../test/support/fake-connection.js';
import { testTimeline } from '../../../../test/support/timeline.js';
import { VirtualClock } from '../../../../test/support/virtual-clock.js';
import { flushAsync } from '../../../../test/support/deferred.js';

const CONFIG_SCHEMA: ConnectorConfigSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: {
      type: 'object',
      additionalProperties: false,
      properties: {
        weight: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } }
      }
    },
    mode: { type: 'string' }
  }
};

const DEFAULT_CONFIG = { prompt: { weight: 0.5, tags: ['warm'] }, mode: 'ambient' };

/**
 * A hand-written validator for the fixture schema above, the way a real connector
 * ships one: no schema compiler, and every problem named by JSON Pointer.
 */
function validateFixture(config: ConnectorConfig): ConnectorConfigValidation {
  const problems: ConnectorConfigProblem[] = [];
  const add = (path: string, code: string, message: string): void => {
    problems.push(Object.freeze({ path, code, message }));
  };
  for (const key of Object.keys(config)) {
    if (key !== 'prompt' && key !== 'mode') {
      add(`/${key}`, 'unknown-member', 'This member is not part of the configuration.');
    }
  }
  if (config.mode !== undefined && typeof config.mode !== 'string') {
    add('/mode', 'wrong-type', 'The mode must be a string.');
  }
  const prompt = config.prompt;
  if (prompt !== undefined) {
    if (prompt === null || typeof prompt !== 'object' || Array.isArray(prompt)) {
      add('/prompt', 'wrong-type', 'The prompt must be an object.');
    } else {
      const members = prompt as Record<string, unknown>;
      for (const key of Object.keys(members)) {
        if (key !== 'weight' && key !== 'tags') {
          add(`/prompt/${key}`, 'unknown-member', 'This member is not part of the configuration.');
        }
      }
      if (members.weight !== undefined && typeof members.weight !== 'number') {
        add('/prompt/weight', 'wrong-type', 'The weight must be a number.');
      }
      const tags = members.tags;
      if (
        tags !== undefined &&
        (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))
      ) {
        add('/prompt/tags', 'wrong-type', 'Every tag must be a string.');
      }
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/** A connector with the fixture schema, recording every config it is asked to check. */
function configuredConnector(defaultConfig: ConnectorConfig = DEFAULT_CONFIG): {
  connector: FakeConnector;
  validated: ConnectorConfig[];
} {
  const validated: ConnectorConfig[] = [];
  const connector = new FakeConnector({
    description: { configSchema: CONFIG_SCHEMA, defaultConfig },
    validateConfig: (config) => {
      validated.push(config);
      return validateFixture(config);
    }
  });
  return { connector, validated };
}

function thrown(run: () => unknown): RendererError {
  try {
    run();
  } catch (error) {
    return error as RendererError;
  }
  throw new Error('Expected the call to throw.');
}

describe('renderer connector configuration validation', () => {
  it('resolves the connector default configuration when no caller patch is supplied', () => {
    const defaultConfig = { prompt: { weight: 0.5, tags: ['warm'] }, mode: 'ambient' };
    const { connector } = configuredConnector(defaultConfig);
    const renderer = createRenderer({ clock: new VirtualClock(), connector });

    // Mutating the connector's own default object must not leak into the resolved value.
    defaultConfig.prompt.weight = 9;
    defaultConfig.prompt.tags.push('mutated');

    const config = renderer.getConnectorConfig();
    expect(config).toEqual({ prompt: { weight: 0.5, tags: ['warm'] }, mode: 'ambient' });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.prompt)).toBe(true);
    expect(Object.isFrozen((config.prompt as { readonly tags: readonly string[] }).tags)).toBe(
      true
    );
  });

  it('recursively overlays a caller patch onto the connector defaults', () => {
    const renderer = createRenderer({
      clock: new VirtualClock(),
      connector: configuredConnector().connector,
      connectorConfig: { prompt: { weight: 0.9 } }
    });
    expect(renderer.getConnectorConfig()).toEqual({
      prompt: { weight: 0.9, tags: ['warm'] },
      mode: 'ambient'
    });
  });

  it('replaces arrays wholesale and deletes members addressed by null', () => {
    const renderer = createRenderer({
      clock: new VirtualClock(),
      connector: configuredConnector().connector,
      connectorConfig: { prompt: { tags: ['cold'] }, mode: null }
    });
    expect(renderer.getConnectorConfig()).toEqual({ prompt: { weight: 0.5, tags: ['cold'] } });
  });

  it('rejects an invalid caller configuration before connecting', () => {
    const { connector } = configuredConnector();
    expect(
      thrown(() =>
        createRenderer({
          clock: new VirtualClock(),
          connector,
          connectorConfig: { prompt: { weight: 'loud' } } as ConnectorConfig
        })
      )
    ).toMatchObject({ code: 'invalid-configuration' });
    expect(connector.connects).toEqual([]);
  });

  it('rejects connector defaults that violate their own schema, even when a patch would fix them', () => {
    const brokenDefault = { prompt: { weight: 'loud' } } as ConnectorConfig;

    const { connector, validated } = configuredConnector(brokenDefault);
    expect(thrown(() => createRenderer({ clock: new VirtualClock(), connector }))).toMatchObject({
      code: 'invalid-configuration',
      problems: [expect.objectContaining({ path: '/prompt/weight' })]
    });
    expect(connector.connects).toEqual([]);
    expect(validated).toEqual([brokenDefault]);

    const masked = configuredConnector(brokenDefault).connector;
    expect(
      thrown(() =>
        createRenderer({
          clock: new VirtualClock(),
          connector: masked,
          connectorConfig: { prompt: { weight: 0.9 } }
        })
      )
    ).toMatchObject({ code: 'invalid-configuration' });
    expect(masked.connects).toEqual([]);
  });

  it('skips validation when the connector cannot check its own config', () => {
    // `validateConfig` is optional because `Connector` is published, so an older
    // connector must still work.
    const connector = new FakeConnector({
      description: { configSchema: CONFIG_SCHEMA, defaultConfig: { mode: 'ambient' } },
      validateConfig: null
    });
    const renderer = createRenderer({ clock: new VirtualClock(), connector });

    // Nonsense the fixture schema forbids, accepted because nobody can check it.
    expect(
      renderer.updateConnectorConfig({ prompt: { weight: 'loud' } } as ConnectorConfig)
    ).toEqual({ mode: 'ambient', prompt: { weight: 'loud' } });
  });

  it('warns once that the config went unchecked', () => {
    const connector = new FakeConnector({
      description: { configSchema: CONFIG_SCHEMA, defaultConfig: { mode: 'ambient' } },
      validateConfig: null
    });
    const renderer = createRenderer({ clock: new VirtualClock(), connector });
    const warnings: RendererWarning[] = [];
    renderer.on('warning', (warning) => warnings.push(warning));

    renderer.updateConnectorConfig({ prompt: { weight: 'loud' } } as ConnectorConfig);
    renderer.updateConnectorConfig({ mode: 'bright' });

    expect(warnings).toEqual([
      { code: 'connector-config-unvalidated', message: expect.any(String) }
    ]);
  });

  it("surfaces the connector's own problems unchanged", () => {
    const renderer = createRenderer({
      clock: new VirtualClock(),
      connector: new FakeConnector({
        description: { configSchema: CONFIG_SCHEMA, defaultConfig: {} },
        // Only the offending patch, not the empty defaults checked at creation.
        validateConfig: (config) =>
          (config as { prompt?: { weight?: unknown } }).prompt?.weight === undefined
            ? { ok: true }
            : {
                ok: false,
                problems: [{ path: '/prompt/weight', code: 'out-of-range', message: 'Too loud.' }]
              }
      })
    });
    const caught = thrown(() => renderer.updateConnectorConfig({ prompt: { weight: 99 } }));
    expect(caught.code).toBe('invalid-configuration');
    expect(caught.problems).toEqual([
      { path: '/prompt/weight', code: 'out-of-range', message: 'Too loud.' }
    ]);
  });

  it('rejects non-JSON connector defaults as an invalid contract', () => {
    const { connector } = configuredConnector({ when: () => 1 } as unknown as ConnectorConfig);
    expect(thrown(() => createRenderer({ clock: new VirtualClock(), connector }))).toMatchObject({
      code: 'invalid-configuration'
    });
    expect(connector.connects).toEqual([]);
  });

  it('rejects a non-JSON caller patch as invalid configuration', () => {
    for (const connectorConfig of [{ prompt: undefined }, { at: new Date() }]) {
      const connector = new FakeConnector({
        description: { configSchema: { type: 'object' }, defaultConfig: {} }
      });
      expect(
        thrown(() =>
          createRenderer({
            clock: new VirtualClock(),
            connector,
            connectorConfig: connectorConfig as unknown as ConnectorConfig
          })
        )
      ).toMatchObject({ code: 'invalid-configuration' });
      expect(connector.connects).toEqual([]);
    }
  });

  it('runs every configuration path without generating code', () => {
    // A browser Content Security Policy without 'unsafe-eval' blocks code
    // generation, so no config path may reach for one. Making `Function` throw
    // rather than counting it means a regression fails here instead of drifting.
    const timeline = testTimeline();
    const realFunction = globalThis.Function;
    const forbidden = (): never => {
      throw new Error('Code generation is not available under this policy.');
    };
    globalThis.Function = new Proxy(realFunction, {
      construct: forbidden,
      apply: forbidden
    }) as typeof Function;
    try {
      // Paths one and two: the contract self-check and the caller's own patch.
      const renderer = createRenderer({
        clock: new VirtualClock(),
        connector: configuredConnector().connector,
        connectorConfig: { prompt: { weight: 0.9 } }
      });
      renderer.load(timeline, createInputState(timeline));
      // Paths three and four: an accepted edit and a rejected one.
      expect(renderer.updateConnectorConfig({ mode: 'bright' })).toMatchObject({
        mode: 'bright'
      });
      expect(
        thrown(() =>
          renderer.updateConnectorConfig({ prompt: { weight: 'loud' } } as ConnectorConfig)
        )
      ).toMatchObject({ code: 'invalid-configuration' });
      renderer.close();
    } finally {
      globalThis.Function = realFunction;
    }
  });

  it('validates a configuration update through the connector', () => {
    const { connector, validated } = configuredConnector();
    const renderer = createRenderer({ clock: new VirtualClock(), connector });

    expect(
      thrown(() =>
        renderer.updateConnectorConfig({ prompt: { weight: 'loud' } } as unknown as ConnectorConfig)
      )
    ).toMatchObject({ code: 'invalid-configuration' });
    expect(renderer.updateConnectorConfig({ mode: 'bright' })).toMatchObject({ mode: 'bright' });
    // The connector's own defaults are checked first, at creation. After that
    // the merged candidate is what it sees, never the bare patch.
    expect(validated).toEqual([
      { prompt: { weight: 0.5, tags: ['warm'] }, mode: 'ambient' },
      { prompt: { weight: 'loud', tags: ['warm'] }, mode: 'ambient' },
      { prompt: { weight: 0.5, tags: ['warm'] }, mode: 'bright' }
    ]);
  });

  it('accepts a valid stopped-state update and rejects an invalid one atomically', () => {
    const { connector } = configuredConnector();
    const renderer = createRenderer({ clock: new VirtualClock(), connector });

    const updated = renderer.updateConnectorConfig({ prompt: { tags: ['bright'] }, mode: null });
    expect(updated).toEqual({ prompt: { weight: 0.5, tags: ['bright'] } });
    expect(Object.isFrozen(updated)).toBe(true);
    expect(Object.isFrozen(updated.prompt)).toBe(true);

    const before = renderer.getConnectorConfig();
    expect(
      thrown(() =>
        renderer.updateConnectorConfig({ prompt: { weight: 'loud' } } as ConnectorConfig)
      )
    ).toMatchObject({ code: 'invalid-configuration' });
    expect(renderer.getConnectorConfig()).toBe(before);
    expect(connector.connects).toEqual([]);
  });

  it('reports problems as a path, a code and safe text, and leaks no value', () => {
    const renderer = createRenderer({
      clock: new VirtualClock(),
      connector: configuredConnector().connector
    });
    const caught = thrown(() =>
      renderer.updateConnectorConfig({
        prompt: { weight: 'do-not-leak-rejected-value' }
      } as ConnectorConfig)
    );
    expect(caught.code).toBe('invalid-configuration');
    const problems = (caught.problems ?? []) as ReadonlyArray<object>;
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(Object.keys(problem).sort()).toEqual(['code', 'message', 'path']);
      expect(Object.isFrozen(problem)).toBe(true);
    }
    expect(JSON.stringify(caught)).not.toContain('do-not-leak-rejected-value');
  });

  it('rejects connector-config updates while playing', async () => {
    const renderer = createRenderer({
      clock: new VirtualClock(),
      connector: configuredConnector().connector
    });
    const timeline = testTimeline();
    renderer.load(timeline, createInputState(timeline));
    await renderer.play();
    expect(thrown(() => renderer.updateConnectorConfig({ mode: 'live' }))).toMatchObject({
      code: 'renderer-state-conflict'
    });
    renderer.stop();
  });

  it('rejects connector-config updates while holding', async () => {
    const clock = new VirtualClock();
    const { connector } = configuredConnector();
    const renderer = createRenderer({ clock, connector });
    const timeline = testTimeline({ playback: { mode: 'infinite' } });
    renderer.load(timeline, createInputState(timeline));
    await renderer.play();
    connector.latest().pushAudio(2);
    clock.advanceTo(8);
    await flushAsync();
    expect(thrown(() => renderer.updateConnectorConfig({ mode: 'live' }))).toMatchObject({
      code: 'renderer-state-conflict'
    });
    renderer.stop();
  });

  it('connects with the resolved configuration across updates', async () => {
    const { connector } = configuredConnector();
    const renderer = createRenderer({
      clock: new VirtualClock(),
      connector,
      connectorConfig: { prompt: { weight: 0.9 } }
    });
    const timeline = testTimeline();
    renderer.load(timeline, createInputState(timeline));

    await renderer.play();
    expect(connector.connects[0]?.config).toEqual({
      prompt: { weight: 0.9, tags: ['warm'] },
      mode: 'ambient'
    });
    renderer.stop();

    renderer.updateConnectorConfig({ mode: 'live' });
    await renderer.play();
    expect(connector.connects[1]?.config).toEqual({
      prompt: { weight: 0.9, tags: ['warm'] },
      mode: 'live'
    });
    renderer.stop();
  });
});
