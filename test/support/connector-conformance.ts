// Lifecycle behaviour every realtime connector owes the renderer, whatever its
// provider. A connector package supplies a harness that drives its transport
// deterministically; the cases here say nothing about prompts, formats or
// provider error codes, which each package tests on its own.
import { describe, expect, it } from 'vitest';
import type {
  AudioSink,
  Connector,
  ConnectorAudioChunk,
  ConnectorConfig,
  ConnectorSettings,
  ConnectorTiming,
  EffectiveState,
  RendererFailure
} from '../../packages/gas/src/protocol/index.js';
import { flushAsync } from './deferred.js';
import type { VirtualClock } from './virtual-clock.js';

export interface ConformanceHarness {
  readonly connector: Connector;
  readonly clock: VirtualClock;
  readonly settings: ConnectorSettings;
  readonly config: ConnectorConfig;
  readonly state: EffectiveState;
  readonly timing: ConnectorTiming;
  /** Let the provider connection for the `index`th start finish connecting. */
  connect(index: number): void;
  /** Have the provider report it is ready to generate for the `index`th start. */
  ready(index: number): void;
  /** Have the provider deliver one audio chunk on the `index`th start's connection. */
  audio(index: number): void;
  /** Whether the `index`th start's provider connection has been released. */
  released(index: number): boolean;
}

interface Recorded {
  readonly sink: AudioSink;
  readonly chunks: ConnectorAudioChunk[];
  readonly failures: RendererFailure[];
}

function recorder(): Recorded {
  const chunks: ConnectorAudioChunk[] = [];
  const failures: RendererFailure[] = [];
  return {
    chunks,
    failures,
    sink: {
      push: (chunk) => chunks.push(chunk),
      status: () => undefined,
      warning: () => undefined,
      failure: (failure) => failures.push(failure)
    }
  };
}

function settle(promise: Promise<unknown>): Promise<'resolved' | 'rejected'> {
  return promise.then(
    () => 'resolved' as const,
    () => 'rejected' as const
  );
}

export function describeConnectorConformance(
  name: string,
  makeHarness: () => ConformanceHarness
): void {
  describe(`${name} connector conformance`, () => {
    async function prepared(): Promise<ConformanceHarness> {
      const harness = makeHarness();
      await harness.connector.open(harness.settings);
      await harness.connector.prepare(harness.state, harness.config);
      return harness;
    }

    async function running(harness: ConformanceHarness, index: number, recorded: Recorded) {
      const started = harness.connector.start(recorded.sink, harness.timing, 'run-1');
      await flushAsync();
      harness.connect(index);
      await flushAsync();
      harness.ready(index);
      await started;
    }

    it('settles a start stopped while connecting and releases the late connection', async () => {
      const harness = await prepared();
      const recorded = recorder();
      const started = settle(harness.connector.start(recorded.sink, harness.timing, 'run-1'));
      await flushAsync();

      await harness.connector.stop('run-1');
      expect(await started).toBe('rejected');
      expect(harness.clock.pendingDeadlines()).toEqual([]);

      harness.connect(0);
      await flushAsync();
      expect(harness.released(0)).toBe(true);
      expect(recorded.failures).toEqual([]);
    });

    it('stays closed when a connection lands after Close', async () => {
      const harness = await prepared();
      const recorded = recorder();
      const started = settle(harness.connector.start(recorded.sink, harness.timing, 'run-1'));
      await flushAsync();

      await harness.connector.close();
      expect(await started).toBe('rejected');
      harness.connect(0);
      await flushAsync();

      expect(harness.released(0)).toBe(true);
      await expect(harness.connector.prepare(harness.state, harness.config)).rejects.toBeDefined();
    });

    it('prepares again after a Stop that lands before start', async () => {
      // The renderer stops a run cancelled during prepare without ever starting
      // it; the next Play prepares the connector again.
      const harness = await prepared();
      await harness.connector.stop('run-1');
      await harness.connector.prepare(harness.state, harness.config);
      await running(harness, 0, recorder());
      expect(harness.released(0)).toBe(false);
    });

    it('stops and closes idempotently and leaves no timers behind', async () => {
      const harness = await prepared();
      const recorded = recorder();
      await running(harness, 0, recorded);

      await harness.connector.stop('run-1');
      await harness.connector.stop('run-1');
      expect(harness.released(0)).toBe(true);
      expect(harness.clock.pendingDeadlines()).toEqual([]);
      await harness.connector.close();
      await harness.connector.close();
      expect(recorded.failures).toEqual([]);
    });

    it('keeps a stopped run from reaching a newer run that reuses its id', async () => {
      const harness = await prepared();
      const first = recorder();
      await running(harness, 0, first);
      await harness.connector.stop('run-1');

      await harness.connector.prepare(harness.state, harness.config);
      const second = recorder();
      await running(harness, 1, second);
      harness.audio(0);
      await flushAsync();

      expect(first.chunks).toEqual([]);
      expect(second.chunks).toEqual([]);
      expect(harness.released(1)).toBe(false);
    });

    it('does not throw into the provider when the host sink throws', async () => {
      const harness = await prepared();
      const recorded = recorder();
      const throwing: AudioSink = {
        ...recorded.sink,
        push: () => {
          throw new Error('host bug');
        },
        status: () => {
          throw new Error('host bug');
        }
      };
      await running(harness, 0, { ...recorded, sink: throwing });
      expect(() => harness.audio(0)).not.toThrow();
      await harness.connector.close();
    });
  });
}
