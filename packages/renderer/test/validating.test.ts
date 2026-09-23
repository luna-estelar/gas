import { createInputState } from '@luna-estelar/gas-core';
import type { ConnectorConfig, ConnectorConfigSchema } from '@luna-estelar/gas-protocol';
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

function configuredConnector(): FakeConnector {
  return new FakeConnector({
    description: {
      configSchema: CONFIG_SCHEMA,
      defaultConfig: { prompt: { weight: 0.5, tags: ['warm'] }, mode: 'ambient' }
    }
  });
}

describe('renderer connector configuration validation', () => {
  it('resolves the connector default configuration when no caller patch is supplied', async () => {
    const defaultConfig = { prompt: { weight: 0.5, tags: ['warm'] }, mode: 'ambient' };
    const connector = new FakeConnector({
      description: { configSchema: CONFIG_SCHEMA, defaultConfig }
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
      description: { configSchema: CONFIG_SCHEMA, defaultConfig: brokenDefault }
    });
    await expect(
      createRenderer({ clock: new VirtualClock(), connector, checkConnectorContract: true })
    ).rejects.toMatchObject({
      code: 'connector-unavailable',
      failure: { retryable: false }
    });
    expect(connector.calls).toEqual(['describe']);

    const masked = new FakeConnector({
      description: { configSchema: CONFIG_SCHEMA, defaultConfig: brokenDefault }
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

  it('rejects an invalid connector schema without exposing schema text', async () => {
    const secret = 'schema-secret-marker';
    const connector = new FakeConnector({
      description: {
        configSchema: {
          type: 'object',
          properties: { a: { type: 'not-a-type', title: secret } }
        } as ConnectorConfigSchema,
        defaultConfig: {}
      }
    });
    let caught: unknown;
    try {
      await createRenderer({ clock: new VirtualClock(), connector, checkConnectorContract: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RendererError);
    expect((caught as RendererError).code).toBe('connector-unavailable');
    expect((caught as RendererError).failure?.retryable).toBe(false);
    expect(JSON.stringify(caught)).not.toContain(secret);
    expect(connector.calls).toEqual(['describe']);
  });

  it('rejects an async connector schema', async () => {
    const connector = new FakeConnector({
      description: {
        configSchema: { $async: true, type: 'object' } as ConnectorConfigSchema,
        defaultConfig: {}
      }
    });
    await expect(
      createRenderer({ clock: new VirtualClock(), connector, checkConnectorContract: true })
    ).rejects.toMatchObject({
      code: 'connector-unavailable',
      failure: { retryable: false }
    });
    expect(connector.calls).toEqual(['describe']);
  });

  it('rejects non-JSON connector defaults as a contract failure', async () => {
    const connector = new FakeConnector({
      description: {
        configSchema: { type: 'object' },
        defaultConfig: { when: () => 1 } as unknown as ConnectorConfig
      }
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

  it('starts a session without compiling the connector schema', async () => {
    // The contract check is the only startup path that compiles a schema, and
    // compiling generates code. A browser Content Security Policy without
    // 'unsafe-eval' blocks that, so a default session must never reach it.
    const connector = new FakeConnector({
      description: {
        configSchema: { $async: true, type: 'object' } as ConnectorConfigSchema,
        defaultConfig: {}
      }
    });
    const timeline = testTimeline();
    const realFunction = globalThis.Function;
    let constructed = 0;
    globalThis.Function = new Proxy(realFunction, {
      construct(target, args, newTarget) {
        constructed++;
        return Reflect.construct(target, args, newTarget);
      }
    });
    try {
      const renderer = await createRenderer({ clock: new VirtualClock(), connector });
      await renderer.load(timeline, createInputState(timeline));
      await renderer.close();
    } finally {
      globalThis.Function = realFunction;
    }
    expect(constructed).toBe(0);
    expect(connector.calls).toContain('open');
  });

  it('compiles the connector schema on the first configuration update', async () => {
    const connector = configuredConnector();
    const renderer = await createRenderer({ clock: new VirtualClock(), connector });

    await expect(
      renderer.updateConnectorConfig({ prompt: { weight: 'loud' } } as unknown as ConnectorConfig)
    ).rejects.toMatchObject({ code: 'invalid-configuration' });
    expect(await renderer.updateConnectorConfig({ mode: 'bright' })).toMatchObject({
      mode: 'bright'
    });
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

  it('reports only sanitized schema problem fields', async () => {
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
      expect(Object.keys(problem).sort()).toEqual([
        'instancePath',
        'keyword',
        'message',
        'params',
        'schemaPath'
      ]);
      expect(Object.isFrozen(problem)).toBe(true);
    }
    expect(JSON.stringify(caught)).not.toContain('do-not-leak-rejected-value');
  });

  it('rejects connector-config updates while the renderer is running', async () => {
    const clock = new VirtualClock();
    const connector = configuredConnector();
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
    const connector = configuredConnector();
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
