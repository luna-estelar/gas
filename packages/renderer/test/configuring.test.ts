import { createInputState } from '@luna-estelar/gas-core';
import { describe, expect, it } from 'vitest';
import { createRenderer } from '../src/index.js';
import { FakeConnector } from './support/fake-connector.js';
import { testTimeline } from './support/timeline.js';
import { VirtualClock } from './support/virtual-clock.js';

describe('renderer configuration', () => {
  it('keeps editable defaults separate from built-in timing fallbacks', async () => {
    const renderer = await createRenderer({
      clock: new VirtualClock(),
      connector: new FakeConnector()
    });
    expect(renderer.getDefaults()).toEqual({});
    expect(
      await renderer.updateDefaults({
        tempo: 96,
        timeSignature: { beatsPerBar: 3, beatUnit: 4 }
      })
    ).toEqual({ tempo: 96, timeSignature: { beatsPerBar: 3, beatUnit: 4 } });
    expect(await renderer.updateDefaults({ tempo: undefined })).toEqual({
      timeSignature: { beatsPerBar: 3, beatUnit: 4 }
    });
  });

  it('validates default timing and rebuilds a loaded stopped context', async () => {
    const renderer = await createRenderer({
      clock: new VirtualClock(),
      connector: new FakeConnector()
    });
    const timeline = testTimeline({ musicalContext: undefined });
    await renderer.load(timeline, createInputState(timeline));
    await expect(renderer.updateDefaults({ tempo: 0 })).rejects.toThrow(/greater than zero/);
    await expect(renderer.updateDefaults({ tempo: 80 })).resolves.toEqual({ tempo: 80 });
  });

  it('merges connector config and exposes its schema', async () => {
    const initialConfig = { prompt: { weight: 0.5, tags: ['warm'] } };
    const renderer = await createRenderer({
      clock: new VirtualClock(),
      connector: new FakeConnector(),
      connectorConfig: initialConfig
    });
    initialConfig.prompt.weight = 0.9;
    initialConfig.prompt.tags.push('mutated');
    expect(renderer.getConfigSchema()).toEqual({ type: 'object' });
    const snapshot = renderer.getConnectorConfig();
    expect(snapshot).toEqual({ prompt: { weight: 0.5, tags: ['warm'] } });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.prompt)).toBe(true);
    expect(Object.isFrozen((snapshot.prompt as { readonly tags: readonly string[] }).tags)).toBe(
      true
    );

    const patch = { mapping: { weights: [1, 2] } };
    const updated = await renderer.updateConnectorConfig({ mode: 'ambient', ...patch });
    patch.mapping.weights.push(3);
    expect(updated).toEqual({
      prompt: { weight: 0.5, tags: ['warm'] },
      mapping: { weights: [1, 2] },
      mode: 'ambient'
    });
    expect(Object.isFrozen(updated.mapping)).toBe(true);
    expect(
      Object.isFrozen((updated.mapping as { readonly weights: readonly number[] }).weights)
    ).toBe(true);
  });
});
