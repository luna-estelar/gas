import { applyCommand, createInputState } from '@luna-estelar/gas-core';
import { ConnectorError } from '@luna-estelar/gas-protocol';
import type { CapabilitiesTable, InputState, RendererFailure } from '@luna-estelar/gas-protocol';
import { describe, expect, it } from 'vitest';
import { createRenderer, RendererError } from '../src/index.js';
import { FakeConnector } from './support/fake-connector.js';
import { testTimeline } from './support/timeline.js';
import { VirtualClock } from './support/virtual-clock.js';

describe('renderer connector failure propagation', () => {
  it('preserves a ConnectorError thrown from describe', async () => {
    const connector = new FakeConnector({
      describeFailure: new ConnectorError({
        code: 'x-describe',
        reason: 'network',
        retryable: true
      })
    });
    const caught = await createRejects(createRenderer({ clock: new VirtualClock(), connector }));
    expect(caught).toMatchObject({
      code: 'connector-unavailable',
      failure: {
        code: 'x-describe',
        reason: 'network',
        retryable: true,
        message: 'The renderer could not initialize its connector.'
      }
    });
  });

  it('preserves a ConnectorError thrown from open', async () => {
    const connector = new FakeConnector({
      openFailure: new ConnectorError({ code: 'x-open', reason: 'auth', retryable: false })
    });
    const caught = await createRejects(createRenderer({ clock: new VirtualClock(), connector }));
    expect(caught).toMatchObject({
      code: 'connector-unavailable',
      failure: { code: 'x-open', reason: 'auth', retryable: false }
    });
  });

  it('preserves a ConnectorError thrown from prepare during start', async () => {
    await expectStartPreserves(
      new FakeConnector({
        prepareFailure: new ConnectorError({ code: 'x-prepare', reason: 'quota', retryable: false })
      }),
      { code: 'x-prepare', reason: 'quota', retryable: false }
    );
  });

  it('preserves a ConnectorError thrown from start', async () => {
    await expectStartPreserves(
      new FakeConnector({
        startFailure: new ConnectorError({ code: 'x-start', reason: 'provider', retryable: true })
      }),
      { code: 'x-start', reason: 'provider', retryable: true }
    );
  });

  it('preserves a ConnectorError thrown from a running state update', async () => {
    const connector = new FakeConnector({
      updateFailure: new ConnectorError({ code: 'x-update', reason: 'provider', retryable: true })
    });
    const clock = new VirtualClock();
    const renderer = await createRenderer({ clock, connector, runIdFactory: () => 'run-1' });
    const timeline = testTimeline();
    await renderer.load(timeline, createInputState(timeline));
    await renderer.start();

    const state = applyActive(createInputState(timeline), {
      kind: 'setTrackFlavor',
      trackId: 'track.pad',
      value: 'brighter'
    });
    const caught = await createRejects(renderer.updateState(state));
    expect(caught).toMatchObject({
      code: 'connector-unavailable',
      failure: { code: 'x-update', reason: 'provider', retryable: true, runId: 'run-1' }
    });
  });

  it('preserves a ConnectorError thrown from a scheduled boundary update', async () => {
    const connector = new FakeConnector({
      updateFailure: new ConnectorError({ code: 'x-scheduled', reason: 'network', retryable: true })
    });
    const clock = new VirtualClock();
    const renderer = await createRenderer({ clock, connector, runIdFactory: () => 'run-1' });
    const timeline = testTimeline({ playback: { mode: 'loop', declaredBars: 4 } });
    await renderer.load(timeline, createInputState(timeline));
    const failures: RendererFailure[] = [];
    renderer.on('failure', (failure) => failures.push(failure));
    await renderer.start();
    clock.advanceTo(8);
    await flushAsync();

    expect(failures.at(-1)).toMatchObject({
      code: 'x-scheduled',
      reason: 'network',
      retryable: true,
      runId: 'run-1',
      message: 'Audio generation failed during playback.'
    });
  });

  it('preserves a ConnectorError thrown from stop', async () => {
    const connector = new FakeConnector({
      stopFailure: new ConnectorError({ code: 'x-stop', reason: 'quota', retryable: false })
    });
    const clock = new VirtualClock();
    const renderer = await createRenderer({ clock, connector, runIdFactory: () => 'run-1' });
    const timeline = testTimeline({ playback: { mode: 'infinite' } });
    await renderer.load(timeline, createInputState(timeline));
    const failures: RendererFailure[] = [];
    renderer.on('failure', (failure) => failures.push(failure));
    await renderer.start();

    const caught = await createRejects(renderer.stop());
    expect(caught).toMatchObject({
      code: 'connector-unavailable',
      failure: { code: 'x-stop', reason: 'quota', retryable: false, runId: 'run-1' }
    });
    expect(failures.at(-1)).toMatchObject({ code: 'x-stop', reason: 'quota', retryable: false });
  });

  it('preserves a ConnectorError thrown from close', async () => {
    const connector = new FakeConnector({
      closeFailure: new ConnectorError({ code: 'x-close', reason: 'internal', retryable: true })
    });
    const renderer = await createRenderer({ clock: new VirtualClock(), connector });
    const failures: RendererFailure[] = [];
    renderer.on('failure', (failure) => failures.push(failure));

    const caught = await createRejects(renderer.close());
    // The connector's own retryable wins over close's default false.
    expect(caught).toMatchObject({
      code: 'connector-unavailable',
      failure: { code: 'x-close', reason: 'internal', retryable: true }
    });
    expect(failures.at(-1)).toMatchObject({ code: 'x-close', retryable: true });
  });

  it('keeps unknown thrown values generic and never leaks their contents', async () => {
    const secret = 'do-not-leak-unknown-failure';
    const cases: unknown[] = [
      new Error(`provider rejected ${secret}`),
      `raw string with ${secret}`,
      { code: 'x-object', reason: 'auth', retryable: false, message: secret },
      renamedLookalike(secret)
    ];

    for (const failure of cases) {
      const connector = new FakeConnector({ openFailure: failure as Error });
      const caught = await createRejects(createRenderer({ clock: new VirtualClock(), connector }));
      expect(caught).toMatchObject({
        code: 'connector-unavailable',
        failure: {
          code: 'connector-unavailable',
          reason: 'internal',
          retryable: true,
          message: 'The renderer could not initialize its connector.'
        }
      });
      expect(JSON.stringify(caught)).not.toContain(secret);
    }
  });
});

function renamedLookalike(secret: string): Error {
  const error = new Error(secret);
  error.name = 'ConnectorError';
  // Wrong field types: the structural guard must reject this, keeping it generic.
  Object.assign(error, { code: 42, reason: 'not-a-reason', retryable: 'yes' });
  return error;
}

async function expectStartPreserves(
  connector: FakeConnector,
  expected: { code: string; reason: string; retryable: boolean }
): Promise<void> {
  const clock = new VirtualClock();
  const renderer = await createRenderer({ clock, connector, runIdFactory: () => 'run-1' });
  const timeline = testTimeline();
  await renderer.load(timeline, createInputState(timeline));
  const failures: RendererFailure[] = [];
  renderer.on('failure', (failure) => failures.push(failure));

  const caught = await createRejects(renderer.start());
  expect(caught).toMatchObject({
    code: 'connector-unavailable',
    failure: { ...expected, runId: 'run-1' }
  });
  expect(failures.at(-1)).toMatchObject({
    ...expected,
    runId: 'run-1',
    message: 'The connector could not start this renderer run.'
  });
}

async function createRejects(promise: Promise<unknown>): Promise<RendererError> {
  try {
    await promise;
  } catch (error) {
    return error as RendererError;
  }
  throw new Error('Expected the operation to reject.');
}

function applyActive(state: InputState, command: Parameters<typeof applyCommand>[1]): InputState {
  const result = applyCommand(state, command, {
    phase: 'active',
    capabilities: allSupportedCapabilities()
  });
  if (!result.ok) throw new Error(result.failure.message);
  return result.state;
}

function allSupportedCapabilities(): CapabilitiesTable {
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

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
