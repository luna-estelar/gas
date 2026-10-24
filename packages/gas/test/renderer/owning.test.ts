// Who owns a run once Stop, Close or a failure lands while connector work is
// still in flight. Each case holds one connector call open and checks that the
// local outcome is published without waiting for it, exactly once, and never
// lets a late continuation revive or fail a run the host already ended.
import { applyCommand, createInputState } from '../../src/core/index.js';
import { ConnectorError } from '../../src/protocol/index.js';
import type {
  CapabilitiesTable,
  InputState,
  Renderer,
  RendererFailure,
  RendererStatusEvent,
  RendererWarning,
  Timeline
} from '../../src/protocol/index.js';
import { describe, expect, it, vi } from 'vitest';
import { createRenderer, RendererError } from '../../src/renderer/index.js';
import { CONNECTOR_CLEANUP_TIMEOUT_SECONDS } from '../../src/renderer/constants.js';
import {
  FakeConnector,
  anchorChunk,
  type FakeConnectorOptions
} from '../../../../test/support/fake-connector.js';
import { deferred, flushAsync } from '../../../../test/support/deferred.js';
import { testTimeline } from '../../../../test/support/timeline.js';
import { VirtualClock } from '../../../../test/support/virtual-clock.js';

describe('renderer run ownership', () => {
  it('stops without waiting for a state update that never settles', async () => {
    const harness = await running({ updateGate: new Promise(() => undefined) });
    void harness.renderer.updateState(changed(harness.timeline)).catch(() => undefined);
    await flushAsync();

    await harness.renderer.stop();
    expect(harness.connector.calls).toContain('stop:run-1');
    expect(harness.statuses.at(-1)).toMatchObject({ lifecycle: 'ready', playback: 'stopped' });
  });

  it('closes without waiting for a state update that never settles', async () => {
    const harness = await running({ updateGate: new Promise(() => undefined) });
    void harness.renderer.updateState(changed(harness.timeline)).catch(() => undefined);
    await flushAsync();

    await harness.renderer.close();
    expect(harness.connector.calls.slice(-2)).toEqual(['stop:run-1', 'close']);
    expect(harness.statuses.at(-1)).toMatchObject({ lifecycle: 'closed' });
  });

  it('reports a connector failure while a state update is blocked', async () => {
    const harness = await running({ updateGate: new Promise(() => undefined) });
    void harness.renderer.updateState(changed(harness.timeline)).catch(() => undefined);
    await flushAsync();

    harness.connector.sink!.failure({
      code: 'x-dropped',
      message: 'ignored',
      reason: 'network',
      runId: 'run-1',
      retryable: true
    });
    await flushAsync();
    expect(harness.failures).toMatchObject([{ code: 'x-dropped', runId: 'run-1' }]);
    expect(harness.statuses.at(-1)).toMatchObject({ lifecycle: 'failed' });
  });

  it('publishes Stop after a bounded wait for a connector stop that hangs', async () => {
    const harness = await running({ stopGate: new Promise(() => undefined) });
    vi.useFakeTimers();
    try {
      const stopped = harness.renderer.stop();
      await flushAsync();
      expect(harness.statuses.at(-1)).toMatchObject({ playback: 'stopping' });

      // The cleanup deadline is wall time: the musical clock is left where it is,
      // as a suspended AudioContext would leave it, and the wait still ends.
      await vi.advanceTimersByTimeAsync(CONNECTOR_CLEANUP_TIMEOUT_SECONDS * 1000);
      await stopped;
    } finally {
      vi.useRealTimers();
    }
    expect(harness.statuses.at(-1)).toMatchObject({ lifecycle: 'ready', playback: 'stopped' });
    expect(harness.warnings.map((warning) => warning.code)).toContain('connector-stop-timeout');
  });

  it('publishes Close after a bounded wait for a connector close that hangs', async () => {
    const harness = await running({ closeGate: new Promise(() => undefined) });
    vi.useFakeTimers();
    try {
      const closed = harness.renderer.close();
      await vi.advanceTimersByTimeAsync(CONNECTOR_CLEANUP_TIMEOUT_SECONDS * 1000);
      await closed;
    } finally {
      vi.useRealTimers();
    }
    expect(harness.statuses.at(-1)).toMatchObject({ lifecycle: 'closed' });
    expect(harness.warnings.map((warning) => warning.code)).toContain('connector-close-timeout');
  });

  it('never starts the connector for a run stopped during prepare', async () => {
    const gate = deferred();
    const harness = await loaded({ prepareGate: gate.promise });
    const started = harness.renderer.start();
    await flushAsync();

    await harness.renderer.stop();
    gate.resolve();
    const caught = await rejection(started);

    expect(caught).toBeInstanceOf(RendererError);
    expect(caught.code).toBe('renderer-state-conflict');
    expect(harness.connector.calls).not.toContain('start');
    expect(harness.failures).toEqual([]);
    expect(harness.statuses.at(-1)).toMatchObject({ lifecycle: 'ready', playback: 'stopped' });
  });

  it('rejects a start that settles after Stop without reporting a failure', async () => {
    const gate = deferred();
    const harness = await loaded({ startGate: gate.promise });
    const started = harness.renderer.start();
    await flushAsync();

    await harness.renderer.stop();
    gate.reject(new ConnectorError({ code: 'x-late', reason: 'network', retryable: true }));
    await rejection(started);

    expect(harness.failures).toEqual([]);
    expect(harness.statuses.at(-1)).toMatchObject({ lifecycle: 'ready', playback: 'stopped' });
  });

  it('keeps Closed terminal when prepare rejects after Close', async () => {
    const gate = deferred();
    const harness = await loaded({ prepareGate: gate.promise });
    const started = harness.renderer.start();
    await flushAsync();

    await harness.renderer.close();
    gate.reject(new ConnectorError({ code: 'x-late', reason: 'network', retryable: true }));
    const caught = await rejection(started);

    expect(caught.code).toBe('renderer-closed');
    expect(harness.failures).toEqual([]);
    expect(harness.statuses.at(-1)).toMatchObject({ lifecycle: 'closed' });
  });

  it('keeps Closed terminal when a failure lands during Close', async () => {
    const gate = deferred();
    const harness = await running({ stopGate: gate.promise });
    const closed = harness.renderer.close();
    await flushAsync();

    harness.connector.sink!.failure({
      code: 'x-late',
      message: 'ignored',
      reason: 'network',
      runId: 'run-1',
      retryable: true
    });
    gate.resolve();
    await closed;
    await flushAsync();

    expect(harness.failures).toEqual([]);
    expect(harness.statuses.at(-1)).toMatchObject({ lifecycle: 'closed' });
  });

  it('reports a connector stop failure to a Stop racing finite completion', async () => {
    const gate = deferred();
    const harness = await running({
      stopGate: gate.promise,
      stopFailure: new ConnectorError({ code: 'x-stop', reason: 'network', retryable: true })
    });
    // Four bars at 120 BPM: completion is due eight seconds after the anchor.
    harness.clock.advanceBy(8);
    await flushAsync();
    expect(harness.connector.calls).toContain('stop:run-1');

    const stopped = harness.renderer.stop();
    gate.resolve();
    const caught = await rejection(stopped);

    expect(caught.failure).toMatchObject({ code: 'x-stop' });
    expect(harness.failures).toMatchObject([{ code: 'x-stop' }]);
  });

  it('ignores a stale sink whose run id label was reused', async () => {
    const harness = await running();
    const staleSink = harness.connector.sink!;
    await harness.renderer.stop();
    await harness.renderer.start();

    staleSink.failure({
      code: 'x-stale',
      message: 'ignored',
      reason: 'network',
      runId: 'run-1',
      retryable: true
    });
    staleSink.warning({ code: 'x-stale-warning', message: 'ignored', runId: 'run-1' });
    await flushAsync();

    expect(harness.failures).toEqual([]);
    expect(harness.warnings.map((warning) => warning.code)).not.toContain('x-stale-warning');
    expect(harness.statuses.at(-1)).toMatchObject({ lifecycle: 'ready', playback: 'running' });
  });

  it('fails the run instead of throwing into push for an invalid chunk', async () => {
    const harness = await running();
    expect(() =>
      harness.connector.sink!.push({ ...anchorChunk('run-1'), durationSeconds: Number.NaN })
    ).not.toThrow();
    await flushAsync();

    expect(harness.failures).toMatchObject([
      { code: 'invalid-audio', reason: 'provider', runId: 'run-1' }
    ]);
  });

  it('turns a throwing connector validator into a configuration error', async () => {
    const connector = new FakeConnector({
      validateConfig: (config) => {
        if ('boom' in config) throw new TypeError('validator bug');
        return { ok: true };
      }
    });
    const renderer = await createRenderer({ clock: new VirtualClock(), connector });

    const caught = await rejection(renderer.updateConnectorConfig({ boom: true }));
    expect(caught).toBeInstanceOf(RendererError);
    expect(caught.code).toBe('invalid-configuration');
  });
});

interface Harness {
  readonly connector: FakeConnector;
  readonly clock: VirtualClock;
  readonly renderer: Renderer;
  readonly timeline: Timeline;
  readonly statuses: RendererStatusEvent[];
  readonly failures: RendererFailure[];
  readonly warnings: RendererWarning[];
}

async function loaded(options: FakeConnectorOptions = {}): Promise<Harness> {
  const connector = new FakeConnector(options);
  const clock = new VirtualClock();
  const renderer = await createRenderer({ clock, connector, runIdFactory: () => 'run-1' });
  const timeline = testTimeline();
  await renderer.load(timeline, createInputState(timeline));
  const harness: Harness = {
    connector,
    clock,
    renderer,
    timeline,
    statuses: [],
    failures: [],
    warnings: []
  };
  renderer.on('status', (status) => harness.statuses.push(status));
  renderer.on('failure', (failure) => harness.failures.push(failure));
  renderer.on('warning', (warning) => harness.warnings.push(warning));
  return harness;
}

async function running(options: FakeConnectorOptions = {}): Promise<Harness> {
  const harness = await loaded({ anchorOnStart: true, ...options });
  await harness.renderer.start();
  return harness;
}

function changed(timeline: Timeline): InputState {
  const result = applyCommand(
    createInputState(timeline),
    { kind: 'setTrackFlavor', trackId: 'track.pad', value: 'brighter' },
    { phase: 'active', capabilities: allSupported() }
  );
  if (!result.ok) throw new Error(result.failure.message);
  return result.state;
}

async function rejection(promise: Promise<unknown>): Promise<RendererError> {
  try {
    await promise;
  } catch (error) {
    return error as RendererError;
  }
  throw new Error('Expected the operation to reject.');
}

function allSupported(): CapabilitiesTable {
  return {
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
  };
}
