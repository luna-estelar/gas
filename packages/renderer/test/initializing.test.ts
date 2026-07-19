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

  it('sanitizes connector warnings and failures emitted during a run', async () => {
    const secret = 'do-not-leak-runtime-key';
    const connector = new FakeConnector();
    const renderer = await createRenderer({
      clock: new VirtualClock(),
      connector,
      settings: { apiKey: secret },
      runIdFactory: () => 'runtime-run'
    });
    const timeline = testTimeline();
    await renderer.load(timeline, createInputState(timeline));
    const publicSignals: unknown[] = [];
    renderer.on('warning', (warning) => publicSignals.push(warning));
    renderer.on('failure', (failure) => publicSignals.push(failure));
    await renderer.start();

    connector.sink?.warning({
      code: 'provider-warning',
      message: `warning contains ${secret}`,
      runId: 'runtime-run'
    });
    connector.sink?.failure({
      code: 'provider-failure',
      message: `failure contains ${secret}`,
      reason: 'auth',
      runId: 'runtime-run',
      retryable: false
    });
    await flushAsync();

    expect(publicSignals).toEqual([
      expect.objectContaining({
        code: 'provider-warning',
        message: 'The connector reported a renderer warning.'
      }),
      expect.objectContaining({
        code: 'provider-failure',
        message: 'The connector reported an audio generation failure.',
        reason: 'auth',
        retryable: false
      })
    ]);
    expect(JSON.stringify(publicSignals)).not.toContain(secret);
  });

  it('stops and rejects buffered audio when the initial notation update fails', async () => {
    const clock = new VirtualClock();
    const connector = new FakeConnector({
      description: {
        capabilities: {
          intents: {
            flavor: 'supported',
            key: 'supported',
            tempo: 'supported',
            time_signature: 'supported',
            timbre: 'supported',
            level: 'supported',
            notes: 'supported',
            motif: 'supported'
          }
        }
      },
      updateFailure: new Error('initial notation update failed'),
      startChunks: [
        audioChunk('notation-start'),
        audioChunk('notation-start'),
        audioChunk('notation-start')
      ]
    });
    const renderer = await createRenderer({
      clock,
      connector,
      runIdFactory: () => 'notation-start'
    });
    const base = testTimeline();
    const timeline = {
      ...base,
      tracks: base.tracks.map((track) => ({
        ...track,
        defaults: [
          {
            defaultId: 'default.motif',
            action: 'motif' as const,
            value: { kind: 'alda' as const, source: 'o4 c e g' }
          }
        ]
      }))
    };
    await renderer.load(timeline, createInputState(timeline));
    const warnings: string[] = [];
    const failures: string[] = [];
    renderer.on('warning', (warning) => warnings.push(warning.code));
    renderer.on('failure', (failure) => failures.push(failure.code));

    await expect(renderer.start()).rejects.toMatchObject({
      code: 'connector-unavailable',
      failure: { code: 'generation-failed', runId: 'notation-start' }
    });
    expect(warnings).toContain('buffered-audio-rejected');
    expect(failures).toEqual(['generation-failed']);
    expect(connector.calls.filter((call) => call === 'stop:notation-start')).toHaveLength(1);
    expect(clock.pendingDeadlines()).toEqual([]);

    await renderer.close();
    expect(connector.calls.at(-1)).toBe('close');
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

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function audioChunk(runId: string) {
  return {
    runId,
    bytes: new Uint8Array([0, 0]),
    durationSeconds: 2,
    codec: 'pcm',
    sampleFormat: 's16le' as const,
    sampleRate: 48_000,
    channels: 2
  };
}
