import { createInputState } from '@luna-estelar/gas-core';
import { describe, expect, it } from 'vitest';
import { createRenderer, RendererError } from '../src/index.js';
import { FakeConnector } from './support/fake-connector.js';
import { testTimeline } from './support/timeline.js';
import { VirtualClock } from './support/virtual-clock.js';

describe('renderer initialization and loading', () => {
  it('describes and opens the connector before resolving ready', async () => {
    const connector = new FakeConnector();
    const renderer = await createRenderer({ clock: new VirtualClock(), connector });
    expect(connector.calls).toEqual(['describe', 'open']);
    expect(renderer.getModelInfo().modelId).toBe('fake-v1');
    expect(renderer.getCapabilities().intents.tempo).toBe('supported');
  });

  it('sanitizes connector initialization failures and credentials', async () => {
    const secret = 'do-not-leak-this-key';
    const connector = new FakeConnector({ openFailure: new Error(`provider rejected ${secret}`) });
    let caught: unknown;
    try {
      await createRenderer({
        clock: new VirtualClock(),
        connector,
        settings: { apiKey: secret }
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RendererError);
    expect(JSON.stringify(caught)).not.toContain(secret);
    expect((caught as RendererError).code).toBe('connector-unavailable');
  });

  it('loads valid timeline/state pairs and rejects mismatches atomically', async () => {
    const renderer = await createRenderer({
      clock: new VirtualClock(),
      connector: new FakeConnector()
    });
    const timeline = testTimeline();
    await renderer.load(timeline, createInputState(timeline));
    const other = testTimeline({ timelineId: 'other' });
    await expect(renderer.load(other, createInputState(timeline))).rejects.toMatchObject({
      code: 'invalid-timeline'
    });
    await expect(renderer.updateState(createInputState(timeline))).resolves.toEqual({});
  });

  it('rejects invalid timelines before changing the loaded document', async () => {
    const renderer = await createRenderer({
      clock: new VirtualClock(),
      connector: new FakeConnector()
    });
    const valid = testTimeline();
    await renderer.load(valid, createInputState(valid));
    const invalid = testTimeline({ arrangedBars: -1 });
    await expect(renderer.load(invalid, createInputState(invalid))).rejects.toMatchObject({
      code: 'invalid-timeline'
    });
    await expect(renderer.updateState(createInputState(valid))).resolves.toEqual({});
  });

  it('closes idempotently and reports lifecycle changes', async () => {
    const connector = new FakeConnector();
    const renderer = await createRenderer({ clock: new VirtualClock(), connector });
    const statuses: string[] = [];
    renderer.on('status', () => {
      throw new Error('host listener failure');
    });
    renderer.on('status', (event) => statuses.push(event.lifecycle));
    await renderer.close();
    await renderer.close();
    expect(statuses).toEqual(['closing', 'closed']);
    expect(connector.calls.filter((call) => call === 'close')).toHaveLength(1);
  });
});
