import { createInputState } from '@luna-estelar/gas-core';
import type {
  ConnectorConfig,
  ConnectorConfigProblem,
  ConnectorConfigSchema,
  ConnectorConfigValidation,
  RendererWarning
} from '@luna-estelar/gas-protocol';
import { describe, expect, it } from 'vitest';
import { createRenderer, RendererError } from '../src/index.js';
import { FakeConnector } from './support/fake-connector.js';
import { testTimeline } from './support/timeline.js';
import { VirtualClock } from './support/virtual-clock.js';

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

function configuredConnector(): FakeConnector {
  return new FakeConnector({
    description: {
      configSchema: CONFIG_SCHEMA,
      defaultConfig: { prompt: { weight: 0.5, tags: ['warm'] }, mode: 'ambient' }
    },
    validateConfig: validateFixture
  });
}

describe('renderer connector configuration validation', () => {
  it('resolves the connector default configuration when no caller patch is supplied', async () => {
    const defaultConfig = { prompt: { weight: 0.5, tags: ['warm'] }, mode: 'ambient' };
    const connector = new FakeConnector({
      description: { configSchema: CONFIG_SCHEMA, defaultConfig },
      validateConfig: validateFixture
    });
    const renderer = await createRenderer({ clock: new VirtualClock(), connector });

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

  it('recursively overlays a caller patch onto the connector defaults', async () => {
    const renderer = await createRenderer({
      clock: new VirtualClock(),
      connector: configuredConnector(),
      connectorConfig: { prompt: { weight: 0.9 } }
    });
    expect(renderer.getConnectorConfig()).toEqual({
      prompt: { weight: 0.9, tags: ['warm'] },
      mode: 'ambient'
    });
  });

  it('replaces arrays wholesale and deletes members addressed by null', async () => {
    const renderer = await createRenderer({
      clock: new VirtualClock(),
      connector: configuredConnector(),
      connectorConfig: { prompt: { tags: ['cold'] }, mode: null }
    });
    expect(renderer.getConnectorConfig()).toEqual({ prompt: { weight: 0.5, tags: ['cold'] } });
  });

  it('rejects an invalid caller configuration before opening the connector', async () => {
    const connector = configuredConnector();
    await expect(
      createRenderer({
        clock: new VirtualClock(),
        connector,
        connectorConfig: { prompt: { weight: 'loud' } } as ConnectorConfig
      })
    ).rejects.toMatchObject({ code: 'invalid-configuration' });
    expect(connector.calls).toEqual(['describe']);
  });

  it('rejects connector defaults that violate their own schema, even when a patch would fix them', async () => {
    const brokenDefault = { prompt: { weight: 'loud' } } as ConnectorConfig;

    const connector = new FakeConnector({
      description: { configSchema: CONFIG_SCHEMA, defaultConfig: brokenDefault },
      validateConfig: validateFixture
    });
    await expect(
      createRenderer({ clock: new VirtualClock(), connector, checkConnectorContract: true })
    ).rejects.toMatchObject({
      code: 'connector-unavailable',
      failure: { retryable: false }
    });
    expect(connector.calls).toEqual(['describe']);
    expect(connector.validated).toEqual([brokenDefault]);

    const masked = new FakeConnector({
      description: { configSchema: CONFIG_SCHEMA, defaultConfig: brokenDefault },
      validateConfig: validateFixture
    });
    await expect(
      createRenderer({
        clock: new VirtualClock(),
        connector: masked,
        connectorConfig: { prompt: { weight: 0.9 } },
        checkConnectorContract: true
      })
    ).rejects.toMatchObject({ code: 'connector-unavailable', failure: { retryable: false } });
    expect(masked.calls).toEqual(['describe']);
  });

  it('skips validation with one warning when the connector cannot check its own config', async () => {
    // `validateConfig` is optional because `Connector` is published, so an older
    // connector must still work — loudly, and only once.
    const connector = new FakeConnector({
      description: { configSchema: CONFIG_SCHEMA, defaultConfig: { mode: 'ambient' } },
      validateConfig: null
    });
    const renderer = await createRenderer({ clock: new VirtualClock(), connector });
    const warnings: RendererWarning[] = [];
    renderer.on('warning', (warning) => warnings.push(warning));

    // Nonsense the fixture schema forbids, accepted because nobody can check it.
    expect(
      await renderer.updateConnectorConfig({ prompt: { weight: 'loud' } } as ConnectorConfig)
    ).toEqual({ mode: 'ambient', prompt: { weight: 'loud' } });
    await renderer.updateConnectorConfig({ mode: 'bright' });

    expect(warnings).toEqual([
      { code: 'connector-config-unvalidated', message: expect.any(String) }
    ]);
  });

  it("surfaces the connector's own problems unchanged", async () => {
    const renderer = await createRenderer({
      clock: new VirtualClock(),
      connector: new FakeConnector({
        description: { configSchema: CONFIG_SCHEMA, defaultConfig: {} },
        validateConfig: () => ({
          ok: false,
          problems: [{ path: '/prompt/weight', code: 'out-of-range', message: 'Too loud.' }]
        })
      })
    });
    let caught: RendererError | undefined;
    try {
      await renderer.updateConnectorConfig({ prompt: { weight: 99 } });
    } catch (error) {
      caught = error as RendererError;
    }
    expect(caught?.code).toBe('invalid-configuration');
    expect(caught?.problems).toEqual([
      { path: '/prompt/weight', code: 'out-of-range', message: 'Too loud.' }
    ]);
  });

  it('rejects non-JSON connector defaults as a contract failure', async () => {
    const connector = new FakeConnector({
      description: {
        configSchema: { type: 'object' },
        defaultConfig: { when: () => 1 } as unknown as ConnectorConfig
      },
      validateConfig: validateFixture
    });
    await expect(createRenderer({ clock: new VirtualClock(), connector })).rejects.toMatchObject({
      code: 'connector-unavailable',
      failure: { retryable: false }
    });
    expect(connector.calls).toEqual(['describe']);
  });

  it('rejects a non-JSON caller patch as invalid configuration', async () => {
    const undefinedMember = new FakeConnector({
      description: { configSchema: { type: 'object' }, defaultConfig: {} }
    });
    await expect(
      createRenderer({
        clock: new VirtualClock(),
        connector: undefinedMember,
        connectorConfig: { prompt: undefined } as unknown as ConnectorConfig
      })
    ).rejects.toMatchObject({ code: 'invalid-configuration' });
    expect(undefinedMember.calls).toEqual(['describe']);

    const dateMember = new FakeConnector({
      description: { configSchema: { type: 'object' }, defaultConfig: {} }
    });
    await expect(
      createRenderer({
        clock: new VirtualClock(),
        connector: dateMember,
        connectorConfig: { at: new Date() } as unknown as ConnectorConfig
      })
    ).rejects.toMatchObject({ code: 'invalid-configuration' });
    expect(dateMember.calls).toEqual(['describe']);
  });

  it('runs every configuration path without generating code', async () => {
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
      const renderer = await createRenderer({
        clock: new VirtualClock(),
        connector: configuredConnector(),
        connectorConfig: { prompt: { weight: 0.9 } },
        checkConnectorContract: true
      });
      await renderer.load(timeline, createInputState(timeline));
      // Paths three and four: an accepted edit and a rejected one.
      expect(await renderer.updateConnectorConfig({ mode: 'bright' })).toMatchObject({
        mode: 'bright'
      });
      await expect(
        renderer.updateConnectorConfig({ prompt: { weight: 'loud' } } as ConnectorConfig)
      ).rejects.toMatchObject({ code: 'invalid-configuration' });
      await renderer.close();
    } finally {
      globalThis.Function = realFunction;
    }
  });

  it('validates a configuration update through the connector', async () => {
    const connector = configuredConnector();
    const renderer = await createRenderer({ clock: new VirtualClock(), connector });

    await expect(
      renderer.updateConnectorConfig({ prompt: { weight: 'loud' } } as unknown as ConnectorConfig)
    ).rejects.toMatchObject({ code: 'invalid-configuration' });
    expect(await renderer.updateConnectorConfig({ mode: 'bright' })).toMatchObject({
      mode: 'bright'
    });
    // The merged candidate is what the connector sees, not the bare patch.
    expect(connector.validated).toEqual([
      { prompt: { weight: 'loud', tags: ['warm'] }, mode: 'ambient' },
      { prompt: { weight: 0.5, tags: ['warm'] }, mode: 'bright' }
    ]);
  });

  it('accepts a valid stopped-state update and rejects an invalid one atomically', async () => {
    const connector = configuredConnector();
    const renderer = await createRenderer({ clock: new VirtualClock(), connector });

    const updated = await renderer.updateConnectorConfig({
      prompt: { tags: ['bright'] },
      mode: null
    });
    expect(updated).toEqual({ prompt: { weight: 0.5, tags: ['bright'] } });
    expect(Object.isFrozen(updated)).toBe(true);
    expect(Object.isFrozen(updated.prompt)).toBe(true);

    const before = renderer.getConnectorConfig();
    await expect(
      renderer.updateConnectorConfig({ prompt: { weight: 'loud' } } as ConnectorConfig)
    ).rejects.toMatchObject({ code: 'invalid-configuration' });
    expect(renderer.getConnectorConfig()).toBe(before);
    expect(connector.calls).toEqual(['describe', 'open']);
  });

  it('reports problems as a path, a code and safe text, and leaks no value', async () => {
    const renderer = await createRenderer({
      clock: new VirtualClock(),
      connector: configuredConnector()
    });
    let caught: RendererError | undefined;
    try {
      await renderer.updateConnectorConfig({
        prompt: { weight: 'do-not-leak-rejected-value' }
      } as ConnectorConfig);
    } catch (error) {
      caught = error as RendererError;
    }
    expect(caught?.code).toBe('invalid-configuration');
    const problems = caught?.problems as ReadonlyArray<Record<string, unknown>>;
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(Object.keys(problem).sort()).toEqual(['code', 'message', 'path']);
      expect(Object.isFrozen(problem)).toBe(true);
    }
    expect(JSON.stringify(caught)).not.toContain('do-not-leak-rejected-value');
  });

  it('rejects connector-config updates while the renderer is running', async () => {
    const clock = new VirtualClock();
    const connector = new FakeConnector({
      description: {
        configSchema: CONFIG_SCHEMA,
        defaultConfig: { prompt: { weight: 0.5, tags: ['warm'] }, mode: 'ambient' }
      },
      validateConfig: validateFixture,
      anchorOnStart: true
    });
    const renderer = await createRenderer({ clock, connector, runIdFactory: () => 'run-1' });
    const timeline = testTimeline();
    await renderer.load(timeline, createInputState(timeline));
    await renderer.start();
    await expect(renderer.updateConnectorConfig({ mode: 'live' })).rejects.toMatchObject({
      code: 'renderer-state-conflict'
    });
    await renderer.stop();
  });

  it('rejects connector-config updates while the renderer is holding', async () => {
    const clock = new VirtualClock();
    const connector = new FakeConnector({
      description: {
        configSchema: CONFIG_SCHEMA,
        defaultConfig: { prompt: { weight: 0.5, tags: ['warm'] }, mode: 'ambient' }
      },
      validateConfig: validateFixture,
      anchorOnStart: true
    });
    const renderer = await createRenderer({ clock, connector, runIdFactory: () => 'run-1' });
    const timeline = testTimeline({ playback: { mode: 'infinite' } });
    await renderer.load(timeline, createInputState(timeline));
    await renderer.start();
    clock.advanceTo(8);
    await flushAsync();
    await expect(renderer.updateConnectorConfig({ mode: 'live' })).rejects.toMatchObject({
      code: 'renderer-state-conflict'
    });
    await renderer.stop();
  });

  it('prepares the connector with the resolved configuration across updates', async () => {
    const clock = new VirtualClock();
    const connector = configuredConnector();
    let sequence = 0;
    const renderer = await createRenderer({
      clock,
      connector,
      connectorConfig: { prompt: { weight: 0.9 } },
      runIdFactory: () => `run-${++sequence}`
    });
    const timeline = testTimeline();
    await renderer.load(timeline, createInputState(timeline));

    await renderer.start();
    expect(connector.prepared[0]?.config).toEqual({
      prompt: { weight: 0.9, tags: ['warm'] },
      mode: 'ambient'
    });
    await renderer.stop();

    await renderer.updateConnectorConfig({ mode: 'live' });
    await renderer.start();
    expect(connector.prepared[1]?.config).toEqual({
      prompt: { weight: 0.9, tags: ['warm'] },
      mode: 'live'
    });
    await renderer.stop();
  });
});

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
