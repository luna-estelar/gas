import { createInputState } from '../../src/core/index.js';
import { describe, expect, it } from 'vitest';
import { createRenderer } from '../../src/renderer/index.js';
import { FakeConnector } from '../../../../test/support/fake-connection.js';
import { testTimeline } from '../../../../test/support/timeline.js';
import { VirtualClock } from '../../../../test/support/virtual-clock.js';

describe('renderer configuration', () => {
  it('keeps editable defaults separate from built-in timing fallbacks', () => {
    const renderer = createRenderer({ clock: new VirtualClock(), connector: new FakeConnector() });
    expect(renderer.getDefaults()).toEqual({});
    expect(
      renderer.updateDefaults({ tempo: 96, timeSignature: { beatsPerBar: 3, beatUnit: 4 } })
    ).toEqual({ tempo: 96, timeSignature: { beatsPerBar: 3, beatUnit: 4 } });
    expect(renderer.updateDefaults({ tempo: undefined })).toEqual({
      timeSignature: { beatsPerBar: 3, beatUnit: 4 }
    });
  });

  it('validates default timing and rebuilds a loaded stopped context', () => {
    const renderer = createRenderer({ clock: new VirtualClock(), connector: new FakeConnector() });
    const timeline = testTimeline({ musicalContext: undefined });
    renderer.load(timeline, createInputState(timeline));
    expect(() => renderer.updateDefaults({ tempo: 0 })).toThrow(/greater than zero/);
    expect(renderer.updateDefaults({ tempo: 80 })).toEqual({ tempo: 80 });
  });

  it('merges connector config and exposes its schema', () => {
    const initialConfig = { prompt: { weight: 0.5, tags: ['warm'] } };
    const renderer = createRenderer({
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
    const updated = renderer.updateConnectorConfig({ mode: 'ambient', ...patch });
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
