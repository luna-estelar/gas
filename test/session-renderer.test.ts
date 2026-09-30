// The session driving the real Renderer. Every other test of finite completion
// uses a fake on one side or the other, which is how the Renderer came to emit a
// terminal status the session could not recognise: the Renderer cleared its run
// before the last status, so the id the session matches on was already gone.
// Root tests may compose package surfaces; package boundary tests may not.

import { describe, expect, it } from 'vitest';
import { createSession } from '../packages/api/src/index.js';
import { createRenderer } from '../packages/renderer/src/index.js';
import type { LifecycleEvent, WarningEvent } from '../packages/protocol/src/index.js';
import { FakeConnector } from '../packages/renderer/test/support/fake-connector.js';
import { VirtualClock } from '../packages/renderer/test/support/virtual-clock.js';

const SOURCE = `tempo 120
time_signature 4/4
length bars 2

track pad "Warm pad"

section only:
    length bars 2
    bar 1:
        pad.play

only()
`;

describe('a session playing a finite document through the real renderer', () => {
  it('completes each run and plays again from the top', async () => {
    const clock = new VirtualClock();
    // Musical time starts with the first chunk, so a run needs audio to begin.
    const connector = new FakeConnector({ anchorOnStart: true });
    let sequence = 0;
    const session = await createSession({
      createRenderer: () =>
        createRenderer({ clock, connector, runIdFactory: () => `run-${++sequence}` })
    });
    const lifecycles: LifecycleEvent[] = [];
    const warnings: WarningEvent[] = [];
    session.on('lifecycle', (event) => lifecycles.push(event));
    session.on('warning', (warning) => warnings.push(warning));
    await session.loadSource(SOURCE);

    for (const run of ['run-1', 'run-2']) {
      await session.play();
      expect(session.getState()).toMatchObject({ playback: 'active', runId: run });

      // Two bars at 120 BPM 4/4 is four seconds; the run ends at the start of bar
      // three, which is one bar of silence past the end of the arrangement.
      clock.advanceTo(clock.now() + 4);
      await flushAsync();

      expect(session.getState()).toMatchObject({ playback: 'stopped' });
      expect(session.getState().runId).toBeUndefined();
      const completion = lifecycles.filter((event) => event.completed === true);
      expect(completion.at(-1)).toMatchObject({ runId: run, playback: 'stopped' });
      expect(connector.calls.filter((call) => call === `stop:${run}`)).toHaveLength(1);
    }

    // One start and one stop per run, with nothing left armed between them.
    expect(connector.calls.filter((call) => call === 'start')).toHaveLength(2);
    expect(clock.pendingDeadlines()).toEqual([]);
    // The chunk that anchored each run was delivered, not rejected as stale.
    expect(warnings.map((warning) => warning.code)).not.toContain('stale-audio-rejected');
    await session.close();
  });

  it('holds the session open when the provider ends its stream early', async () => {
    // `stream: 'ended'` is a stream that stopped, not a piece that finished. Only
    // the Renderer decides a run is complete, so the session stays playing and the
    // host stays in control of when to stop.
    const clock = new VirtualClock();
    const connector = new FakeConnector({ anchorOnStart: true });
    const session = await createSession({
      createRenderer: () => createRenderer({ clock, connector, runIdFactory: () => 'run-1' })
    });
    await session.loadSource(SOURCE);
    await session.play();

    connector.sink!.status('ended', 'run-1');
    expect(session.getState()).toMatchObject({ playback: 'active', runId: 'run-1' });

    await session.stop();
    expect(session.getState().playback).toBe('stopped');
    await session.close();
  });

  it('reaches the host with a close code the connector never classified', async () => {
    const clock = new VirtualClock();
    const connector = new FakeConnector({ anchorOnStart: true });
    const session = await createSession({
      createRenderer: () => createRenderer({ clock, connector, runIdFactory: () => 'run-1' })
    });
    const errors: unknown[] = [];
    session.on('error', (error) => errors.push(error));
    await session.loadSource(SOURCE);
    await session.play();

    connector.sink!.failure({
      code: 'lyria-network-failure',
      message: 'ignored; the renderer owns the text',
      reason: 'network',
      runId: 'run-1',
      retryable: true,
      closeCode: 4429
    });
    await flushAsync();

    expect(errors.at(-1)).toMatchObject({
      kind: 'renderer',
      code: 'lyria-network-failure',
      reason: 'network',
      retryable: true,
      closeCode: 4429
    });
    expect(session.getState().lifecycle).toBe('failed');
    await session.close();
  });
});

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
