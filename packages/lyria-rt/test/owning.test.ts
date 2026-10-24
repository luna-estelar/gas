// Attempt ownership: Stop and Close while the SDK is still connecting, sessions
// that arrive after nobody wants them, reused run ids, and an error event racing
// the close that explains it.
import { describe, expect, it } from 'vitest';
import type {
  AudioSink,
  ConnectorTiming,
  EffectiveState,
  RendererFailure
} from '@luna-estelar/gas/protocol';
import {
  createLyriaRtConnectorWithDependencies,
  type LyriaRtConnectorDependencies,
  type LyriaRtMusicSession,
  type LyriaRtSdkClient
} from '../src/connector.js';
import { DEFAULT_LYRIA_RT_CONFIG } from '../src/config.js';
import { VirtualClock } from '../../../test/support/virtual-clock.js';

const STATE: EffectiveState = {
  globals: { flavor: { kind: 'text', text: 'warm' }, tempo: 96 },
  tracks: [{ trackId: 'pad', name: 'pad', description: 'soft chords', active: true }]
};

const TIMING: ConnectorTiming = {
  tempo: 96,
  timeSignature: { beatsPerBar: 4, beatUnit: 4 },
  secondsPerBar: 2.5
};

const CONFIG = {
  prompt: { ...DEFAULT_LYRIA_RT_CONFIG.prompt, transitionDurationMs: 0, transitionSteps: 1 },
  generation: DEFAULT_LYRIA_RT_CONFIG.generation
};

type Callbacks = Parameters<LyriaRtSdkClient['connect']>[0]['callbacks'];

class Session implements LyriaRtMusicSession {
  readonly calls: string[] = [];
  async setWeightedPrompts(): Promise<void> {
    this.calls.push('prompts');
  }
  async setMusicGenerationConfig(): Promise<void> {
    this.calls.push('config');
  }
  play(): void {
    this.calls.push('play');
  }
  pause(): void {
    this.calls.push('pause');
  }
  stop(): void {
    this.calls.push('stop');
  }
  resetContext(): void {
    this.calls.push('reset');
  }
  close(): void {
    this.calls.push('close');
  }
}

/** One SDK connection whose `connect` resolves only when the test says so. */
interface Connection {
  readonly session: Session;
  readonly callbacks: Callbacks;
  resolve(): void;
  reject(error: unknown): void;
}

function harness() {
  const clock = new VirtualClock();
  const connections: Connection[] = [];
  const createClient: LyriaRtConnectorDependencies['createClient'] = () => ({
    connect: ({ callbacks }) =>
      new Promise<LyriaRtMusicSession>((resolve, reject) => {
        const session = new Session();
        connections.push({
          session,
          callbacks,
          resolve: () => resolve(session),
          reject
        });
      })
  });
  const connector = createLyriaRtConnectorWithDependencies({
    clock,
    setupTimeoutSeconds: 15,
    createClient
  });
  const failures: RendererFailure[] = [];
  const sink: AudioSink = {
    push: () => undefined,
    status: () => undefined,
    warning: () => undefined,
    failure: (failure) => failures.push(failure)
  };
  return { clock, connections, connector, sink, failures };
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

async function settle(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => 'resolved',
    (error: unknown) => error
  );
}

describe('Lyria RealTime attempt ownership', () => {
  it('settles a start promptly when stopped while connecting, then closes the late session', async () => {
    const { clock, connections, connector, sink, failures } = harness();
    await connector.open({ apiKey: 'test-key' });
    await connector.prepare(STATE, CONFIG);
    const started = settle(connector.start(sink, TIMING, 'run-1'));
    await flushAsync();

    await connector.stop('run-1');
    expect(await started).toMatchObject({ code: 'lyria-rt-start-cancelled' });
    expect(clock.pendingDeadlines()).toEqual([]);

    connections[0].resolve();
    await flushAsync();
    expect(connections[0].session.calls).toEqual(['close']);
    expect(failures).toEqual([]);
  });

  it('stays closed when the connection arrives after Close', async () => {
    const { connections, connector, sink } = harness();
    await connector.open({ apiKey: 'test-key' });
    await connector.prepare(STATE, CONFIG);
    const started = settle(connector.start(sink, TIMING, 'run-1'));
    await flushAsync();

    await connector.close();
    expect(await started).toMatchObject({ code: 'lyria-rt-start-cancelled' });
    connections[0].resolve();
    await flushAsync();

    expect(connections[0].session.calls).toEqual(['close']);
    await expect(connector.prepare(STATE, CONFIG)).rejects.toMatchObject({
      code: 'lyria-rt-state-conflict'
    });
  });

  it('closes a session that connects after the setup timeout', async () => {
    const { clock, connections, connector, sink } = harness();
    await connector.open({ apiKey: 'test-key' });
    await connector.prepare(STATE, CONFIG);
    const started = settle(connector.start(sink, TIMING, 'run-1'));
    await flushAsync();

    clock.advanceBy(15);
    expect(await started).toMatchObject({ code: 'lyria-rt-setup-timeout' });
    connections[0].resolve();
    await flushAsync();
    expect(connections[0].session.calls).toEqual(['close']);
  });

  it('keeps a stale attempt off a newer run that reuses its id', async () => {
    const { connections, connector, sink, failures } = harness();
    await connector.open({ apiKey: 'test-key' });
    await connector.prepare(STATE, CONFIG);
    const stale = settle(connector.start(sink, TIMING, 'run-1'));
    await flushAsync();
    await connector.stop('run-1');
    await stale;

    await connector.prepare(STATE, CONFIG);
    const fresh = connector.start(sink, TIMING, 'run-1');
    await flushAsync();
    connections[1].resolve();
    await flushAsync();
    connections[1].callbacks.onmessage({ setupComplete: {} });
    await fresh;

    // The abandoned connection lands now and its callbacks fire late.
    connections[0].resolve();
    connections[0].callbacks.onclose({ code: 1011 });
    await flushAsync();

    expect(connections[0].session.calls).toEqual(['close']);
    expect(connections[1].session.calls).not.toContain('close');
    expect(failures).toEqual([]);
    await connector.update({ state: STATE }, { bar: 2 });
  });

  it('lets the close that follows an error decide the startup failure', async () => {
    const { connections, connector, sink } = harness();
    await connector.open({ apiKey: 'test-key' });
    await connector.prepare(STATE, CONFIG);
    const started = settle(connector.start(sink, TIMING, 'run-1'));
    await flushAsync();
    connections[0].resolve();
    await flushAsync();

    connections[0].callbacks.onerror();
    connections[0].callbacks.onclose({ code: 1008 });
    expect(await started).toMatchObject({
      code: 'lyria-rt-auth-rejected',
      reason: 'auth',
      closeCode: 1008
    });
  });

  it('reports an error with no close as a network failure after a short wait', async () => {
    const { clock, connections, connector, sink, failures } = harness();
    await connector.open({ apiKey: 'test-key' });
    await connector.prepare(STATE, CONFIG);
    const started = connector.start(sink, TIMING, 'run-1');
    await flushAsync();
    connections[0].resolve();
    await flushAsync();
    connections[0].callbacks.onmessage({ setupComplete: {} });
    await started;

    connections[0].callbacks.onerror();
    expect(failures).toEqual([]);
    clock.advanceBy(1);
    expect(failures).toMatchObject([{ code: 'lyria-rt-network-failure', reason: 'network' }]);
  });
});
