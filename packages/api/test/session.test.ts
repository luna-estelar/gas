import { describe, expect, it } from 'vitest';
import { createSession, GasOperationError, sourceBlob, type SessionState } from '../src/index.js';
import { capabilities, capabilitiesWith, createFakeWiring } from './support/fake-renderer.js';

const SOURCE = `tempo 120
key "C minor"
time_signature 4/4
length bars 8

track drums "Lofi breakbeat"
track lead "Bright square lead"

section main:
    length bars 8
    bar 1:
        drums.play
        lead.play

main()
`;

const OTHER_SOURCE = `tempo 90
key "A minor"
time_signature 4/4
length bars 4

track pad "Warm pad"

section only:
    length bars 4
    bar 1:
        pad.play

only()
`;

async function loadedSession(caps = capabilities()) {
  const wiring = createFakeWiring(undefined, caps);
  const session = await createSession(wiring);
  await session.loadSource(SOURCE);
  return { wiring, session };
}

describe('session creation and loading', () => {
  it('starts ready, stopped, with no timeline', async () => {
    const wiring = createFakeWiring();
    const session = await createSession(wiring);
    const state = session.getState();
    expect(state.lifecycle).toBe('ready');
    expect(state.playback).toBe('stopped');
    expect(state.timelineLoaded).toBe(false);
    expect(session.getTracks()).toEqual([]);
  });

  it('loadSource compiles, loads the Renderer, and exposes authored tracks', async () => {
    const { wiring, session } = await loadedSession();
    expect(wiring.current().loads).toHaveLength(1);
    expect(session.getState().timelineLoaded).toBe(true);
    expect(session.getTracks()).toEqual([
      { id: 'track.drums', name: 'drums', description: 'Lofi breakbeat', source: 'authored' },
      { id: 'track.lead', name: 'lead', description: 'Bright square lead', source: 'authored' }
    ]);
  });

  it('compileSource is pure — no session or Renderer mutation', async () => {
    const wiring = createFakeWiring();
    const session = await createSession(wiring);
    const compiled = await session.compileSource(SOURCE);
    expect(compiled.timeline.tracks).toHaveLength(2);
    expect(session.getState().timelineLoaded).toBe(false);
    expect(wiring.current().loads).toHaveLength(0);
  });

  it('both load methods return authored warnings with the same ids emitted as events', async () => {
    for (const method of ['source', 'timeline'] as const) {
      const wiring = createFakeWiring(undefined, capabilitiesWith({ tempo: 'unsupported' }));
      const session = await createSession(wiring);
      const warningIds: string[] = [];
      session.on('warning', (warning) => warningIds.push(warning.warningId));
      const result =
        method === 'source'
          ? await session.loadSource(SOURCE)
          : await session.loadTimeline((await session.compileSource(SOURCE)).timeline);
      expect(result.warnings).toEqual([
        expect.objectContaining({ intent: 'tempo', support: 'unsupported' })
      ]);
      expect(warningIds).toEqual(result.warnings.map((warning) => warning.warningId));
    }
  });
});

describe('command forwarding', () => {
  it('routes a command through Core and forwards the new state to the Renderer', async () => {
    const { wiring, session } = await loadedSession();
    await session.setGlobalFlavor('warm and distant');
    const updates = wiring.current().updates;
    expect(updates).toHaveLength(1);
    expect(updates[0]?.staged).toEqual([{ kind: 'setGlobalFlavor', value: 'warm and distant' }]);
  });

  it('a rejected command throws a structured error and does not forward', async () => {
    const { wiring, session } = await loadedSession();
    await expect(session.setTrackFlavor('ghost', 'x')).rejects.toBeInstanceOf(GasOperationError);
    expect(wiring.current().updates).toHaveLength(0);
  });

  it('carries the Renderer positions on a command applied while active', async () => {
    const { wiring, session } = await loadedSession();
    await session.play();
    wiring.current().updateResult = { requestedPosition: { bar: 2 }, appliedPosition: { bar: 4 } };
    const result = await session.setTempo(140);
    expect(result.requestedPosition).toEqual({ bar: 2 });
    expect(result.appliedPosition).toEqual({ bar: 4 });
  });

  it('carries no position on a command applied while stopped', async () => {
    const { wiring, session } = await loadedSession();
    wiring.current().updateResult = { requestedPosition: { bar: 2 }, appliedPosition: { bar: 4 } };
    const result = await session.setTempo(140);
    expect(result.requestedPosition).toBeUndefined();
    expect(result.appliedPosition).toBeUndefined();
  });

  // A live submission resolves its source and loads the compiler before it can
  // apply anything, and both of those yield. It used to read the session state
  // before that wait and write the result afterwards, so a programmatic command
  // accepted in between was committed and then silently discarded. The source is
  // gated here rather than timed, so the case holds however many times the
  // implementation happens to await.
  it('keeps a command accepted while a live submission was still preparing', async () => {
    const { session } = await loadedSession();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const live = session.submitLiveCommands(
      sourceBlob({
        text: async () => {
          await gate;
          return 'tempo 140';
        }
      })
    );
    await session.defineTrack({ id: 'host.late', name: 'Late' });
    release();

    expect(await live).toMatchObject({ ok: true, applied: 1 });
    expect(session.getTracks().map((track) => track.id)).toContain('host.late');
  });
});

describe('atomic replacement', () => {
  it('leaves the previous document unchanged when a compile fails', async () => {
    const { session } = await loadedSession();
    await expect(session.loadSource('ghost_section()')).rejects.toBeInstanceOf(GasOperationError);
    expect(session.getTracks().map((t) => t.id)).toEqual(['track.drums', 'track.lead']);
  });

  it('leaves the previous document unchanged when the Renderer load fails', async () => {
    const { wiring, session } = await loadedSession();
    wiring.current().failLoad = true;
    await expect(session.loadSource(OTHER_SOURCE)).rejects.toBeInstanceOf(GasOperationError);
    expect(session.getTracks().map((t) => t.id)).toEqual(['track.drums', 'track.lead']);
  });

  it('emits no authored warnings when a load fails', async () => {
    const wiring = createFakeWiring(undefined, capabilitiesWith({ tempo: 'unsupported' }));
    const session = await createSession(wiring);
    const warnings: string[] = [];
    session.on('warning', (warning) => warnings.push(warning.warningId));
    wiring.current().failLoad = true;
    await expect(session.loadSource(SOURCE)).rejects.toBeInstanceOf(GasOperationError);
    expect(warnings).toEqual([]);
  });
});

describe('playback lifecycle', () => {
  it('play records the accepted run and goes active', async () => {
    const { wiring, session } = await loadedSession();
    await session.play();
    expect(wiring.current().starts).toBe(1);
    expect(session.getState().playback).toBe('active');
    expect(session.getState().runId).toBe('run-1');
  });

  it('accepts initial position and audio while play is still pending', async () => {
    const { wiring, session } = await loadedSession();
    let releaseStart: (() => void) | undefined;
    wiring.current().startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const positions: number[] = [];
    const chunks: string[] = [];
    session.on('position', (event) => positions.push(event.position.bar));
    session.on('audio', (chunk) => chunks.push(chunk.runId));

    const play = session.play();
    await Promise.resolve();
    wiring.current().emitStatus({
      lifecycle: 'ready',
      playback: 'starting',
      runId: 'run-1'
    });
    wiring.current().emitPosition('run-1', { bar: 1 });
    wiring.current().emitAudio({ runId: 'run-1' });

    expect(positions).toEqual([1]);
    expect(chunks).toEqual(['run-1']);
    releaseStart?.();
    await play;
  });

  it('rejects a second play while active', async () => {
    const { session } = await loadedSession();
    await session.play();
    await expect(session.play()).rejects.toBeInstanceOf(GasOperationError);
  });

  it('rejects play without a loaded timeline', async () => {
    const wiring = createFakeWiring();
    const session = await createSession(wiring);
    await expect(session.play()).rejects.toBeInstanceOf(GasOperationError);
  });

  it('preserves safe classification from a structured start failure', async () => {
    const { wiring, session } = await loadedSession();
    const thrown = new Error('raw provider text with a credential');
    Object.assign(thrown, {
      failure: {
        code: 'lyria-auth',
        message: 'renderer-safe message',
        reason: 'auth',
        retryable: false
      }
    });
    wiring.current().startError = thrown;

    await expect(session.play()).rejects.toMatchObject({
      message: 'The Renderer failed to start.',
      code: 'lyria-auth',
      reason: 'auth',
      retryable: false
    });
  });

  it('stop is safe when already stopped and clears overrides', async () => {
    const { wiring, session } = await loadedSession();
    await session.play();
    await session.setGlobalFlavor('warm');
    await session.stop();
    expect(session.getState().playback).toBe('stopped');
    // Stop forwards the override-cleared state to the Renderer.
    const last = wiring.current().updates.at(-1);
    expect(last?.staged).toEqual([]);
    expect(last?.live).toEqual([]);
    // Calling stop again is a no-op that still lands stopped.
    await expect(session.stop()).resolves.toBeUndefined();
  });

  it('lands stopped even when the Renderer stop fails, marking it failed', async () => {
    const { wiring, session } = await loadedSession();
    await session.play();
    wiring.current().failStop = true;
    await session.stop();
    expect(session.getState().playback).toBe('stopped');
    expect(session.getState().lifecycle).toBe('failed');
  });

  it('applies the completion transition when the piece finishes', async () => {
    const { wiring, session } = await loadedSession();
    await session.play();
    await session.setGlobalFlavor('warm');
    wiring.current().emitStatus({
      lifecycle: 'ready',
      playback: 'stopped',
      runId: 'run-1',
      completed: true
    });
    expect(session.getState().playback).toBe('stopped');
    expect(session.getState().runId).toBeUndefined();
    // Completion clears live overrides, so the next run starts from the document
    // rather than inheriting what the last one was left holding.
    await session.play();
    expect(session.getState().playback).toBe('active');
    await session.setGlobalFlavor('cool');
    expect(wiring.current().updates.at(-1)?.live).toMatchObject([{ value: 'cool' }]);
  });

  it('leaves the session playing when a provider ends its stream early', async () => {
    // A stream that stopped is not a piece that finished: the renderer decides
    // when a run is complete, and it says so with `completed`.
    const { wiring, session } = await loadedSession();
    await session.play();
    wiring
      .current()
      .emitStatus({ lifecycle: 'ready', playback: 'running', runId: 'run-1', stream: 'ended' });
    expect(session.getState().playback).toBe('active');
    expect(session.getState().runId).toBe('run-1');
  });

  it('ignores a completion that belongs to an earlier run', async () => {
    const { wiring, session } = await loadedSession();
    await session.play();
    await session.stop();
    await session.play();
    expect(session.getState().runId).toBe('run-2');

    wiring.current().emitStatus({
      lifecycle: 'ready',
      playback: 'stopped',
      runId: 'run-1',
      completed: true
    });
    expect(session.getState().playback).toBe('active');
    expect(session.getState().runId).toBe('run-2');
  });

  it('carries a transport close code to the host', async () => {
    const { wiring, session } = await loadedSession();
    const errors: GasOperationError[] = [];
    session.on('error', (error) => errors.push(error));
    await session.play();

    wiring.current().emitFailure({
      code: 'lyria-network-failure',
      message: 'The connector lost its connection.',
      reason: 'network',
      runId: 'run-1',
      retryable: true,
      closeCode: 4429
    });
    expect(errors.at(-1)).toMatchObject({ code: 'lyria-network-failure', closeCode: 4429 });
  });

  it('carries a transport close code out of a failed start', async () => {
    // The thrown RendererError is read structurally, so its nested failure has to
    // survive the trip without the API importing the Renderer.
    const session = await createSession(
      createFakeWiring((renderer) => {
        renderer.startError = Object.assign(new Error('start rejected'), {
          failure: {
            code: 'lyria-auth-rejected',
            message: 'ignored',
            reason: 'auth',
            retryable: false,
            closeCode: 1008
          }
        });
      })
    );
    await session.loadSource(SOURCE);
    const caught = await session.play().catch((error: unknown) => error);
    expect(caught).toMatchObject({ code: 'lyria-auth-rejected', closeCode: 1008 });
  });

  it('drops a close code no transport could have produced', async () => {
    const { wiring, session } = await loadedSession();
    const errors: GasOperationError[] = [];
    session.on('error', (error) => errors.push(error));
    await session.play();

    wiring.current().emitFailure({
      code: 'lyria-network-failure',
      message: 'The connector lost its connection.',
      reason: 'network',
      runId: 'run-1',
      retryable: true,
      closeCode: 99_999
    });
    expect(errors.at(-1)).not.toHaveProperty('closeCode');
  });

  it('reports the settled phase on the lifecycle event when a run auto-ends', async () => {
    const { wiring, session } = await loadedSession();
    const playbacks: string[] = [];
    session.on('lifecycle', (event) => playbacks.push(event.playback));
    await session.play();
    playbacks.length = 0; // ignore the start's lifecycle event
    const events: Array<{ playback: string; completed?: true }> = [];
    session.on('lifecycle', (event) =>
      events.push({
        playback: event.playback,
        ...(event.completed !== undefined ? { completed: event.completed } : {})
      })
    );
    wiring.current().emitStatus({
      lifecycle: 'ready',
      playback: 'stopped',
      runId: 'run-1',
      completed: true
    });
    // The completion transition runs before the lifecycle emit, so the event
    // agrees with the state event instead of claiming 'active' one tick before
    // state lands on 'stopped'. The flag rides along so a host can tell a piece
    // that finished from one it stopped.
    expect(playbacks).toEqual(['stopped']);
    expect(events).toEqual([{ playback: 'stopped', completed: true }]);
  });

  it('relays authoritative renderer playback and stream details', async () => {
    const { wiring, session } = await loadedSession();
    const events: Array<{
      rendererPlayback: string;
      stream?: string;
      throttled?: boolean;
    }> = [];
    session.on('lifecycle', (event) => events.push(event));

    wiring.current().emitStatus({
      lifecycle: 'ready',
      playback: 'holding',
      runId: 'run-1',
      stream: 'throttled',
      throttled: true
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      rendererPlayback: 'holding',
      stream: 'throttled',
      throttled: true
    });
  });
});

describe('stale audio and position rejection', () => {
  it('drops audio that does not match the accepted run', async () => {
    const { wiring, session } = await loadedSession();
    const chunks: string[] = [];
    session.on('audio', (chunk) => chunks.push(chunk.runId));
    await session.play(); // accepts run-1
    wiring.current().emitAudio({ runId: 'run-1' });
    wiring.current().emitAudio({ runId: 'run-0' });
    expect(chunks).toEqual(['run-1']);
  });

  it('drops audio from the accepted run after stop clears it', async () => {
    const { wiring, session } = await loadedSession();
    const chunks: string[] = [];
    session.on('audio', (chunk) => chunks.push(chunk.runId));
    await session.play();
    await session.stop();
    wiring.current().emitAudio({ runId: 'run-1' });
    expect(chunks).toEqual([]);
  });

  it('drops position events from a stale run', async () => {
    const { wiring, session } = await loadedSession();
    const bars: number[] = [];
    session.on('position', (event) => bars.push(event.position.bar));
    await session.play();
    wiring.current().emitPosition('run-1', { bar: 3 });
    wiring.current().emitPosition('run-0', { bar: 9 });
    expect(bars).toEqual([3]);
  });
});

describe('retryRenderer', () => {
  it('preserves safe renderer failure classification on operation errors', async () => {
    const { wiring, session } = await loadedSession();
    const errors: GasOperationError[] = [];
    session.on('error', (error) => errors.push(error));

    wiring.current().emitFailure({
      code: 'lyria-auth',
      message: 'The connector reported an authentication failure.',
      reason: 'auth',
      retryable: false
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      kind: 'renderer',
      code: 'lyria-auth',
      reason: 'auth',
      retryable: false
    });
  });

  it('preserves host tracks, clears overrides, and reloads a fresh Renderer', async () => {
    const { wiring, session } = await loadedSession();
    await session.defineTrack({ id: 'track.bass', name: 'bass', description: 'deep bass' });
    await session.setGlobalFlavor('warm');
    await session.play();
    wiring
      .current()
      .emitFailure({ code: 'boom', message: 'provider died', reason: 'provider', retryable: true });
    expect(session.getState().lifecycle).toBe('failed');

    await session.retryRenderer();

    expect(wiring.renderers).toHaveLength(2);
    const fresh = wiring.renderers[1]!;
    expect(fresh.loads).toHaveLength(1);
    // Host track survives; overrides are cleared.
    const reloaded = fresh.loads[0]!.inputState;
    expect(reloaded.hostTracks.map((t) => t.id)).toEqual(['track.bass']);
    expect(reloaded.staged).toEqual([]);
    expect(session.getTracks().some((t) => t.id === 'track.bass')).toBe(true);
    expect(session.getState().lifecycle).toBe('ready');
    expect(session.getState().playback).toBe('stopped');
  });

  it('rejects stale audio from the pre-retry run', async () => {
    const { wiring, session } = await loadedSession();
    const chunks: string[] = [];
    session.on('audio', (chunk) => chunks.push(chunk.runId));
    await session.play(); // run-1 on renderer 0
    wiring.renderers[0]!.emitFailure({ code: 'x', message: 'died', retryable: true });
    await session.retryRenderer();
    await session.play(); // run-1 on renderer 1 (fresh counter)
    // A chunk from the old renderer must never reach subscribers again.
    wiring.renderers[0]!.emitAudio({ runId: 'run-1' });
    // The new run is also 'run-1' but on the new renderer; it is accepted.
    wiring.renderers[1]!.emitAudio({ runId: 'run-1' });
    expect(chunks).toEqual(['run-1']);
    // Exactly one delivery, from the fresh renderer.
    expect(chunks).toHaveLength(1);
  });

  it('discards a candidate that cannot reload and permits a later successful retry', async () => {
    let creation = 0;
    const wiring = createFakeWiring((renderer) => {
      creation += 1;
      renderer.failLoad = creation === 2;
    });
    const session = await createSession(wiring);
    await session.loadSource(SOURCE);
    wiring.current().emitFailure({ code: 'x', message: 'died', retryable: true });
    const failures: GasOperationError[] = [];
    session.on('error', (error) => failures.push(error));

    await expect(session.retryRenderer()).rejects.toMatchObject({
      name: 'GasOperationError',
      kind: 'renderer',
      message: 'The fresh Renderer failed to reload the timeline.'
    });
    expect(failures).toHaveLength(1);
    expect(wiring.renderers[1]?.closes).toBe(1);
    expect(session.getState()).toMatchObject({ lifecycle: 'failed', playback: 'stopped' });

    await expect(session.retryRenderer()).resolves.toBeUndefined();
    expect(wiring.renderers[2]?.loads).toHaveLength(1);
    expect(session.getState()).toMatchObject({ lifecycle: 'ready', playback: 'stopped' });
  });
});

describe('events and single-channel warnings', () => {
  it('fans a state event out to every subscriber', async () => {
    const { session } = await loadedSession();
    const a: SessionState[] = [];
    const b: SessionState[] = [];
    session.on('state', (s) => a.push(s));
    session.on('state', (s) => b.push(s));
    await session.setGlobalFlavor('warm');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('emits a warning once, sharing the id between result and event', async () => {
    const { session } = await loadedSession(capabilitiesWith({ flavor: 'unsupported' }));
    const events: string[] = [];
    session.on('warning', (w) => events.push(w.warningId));
    const result = await session.setGlobalFlavor('warm');
    expect(result.warnings).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toBe(result.warnings[0]?.warningId);
  });

  it('keeps global level silent while an approximated track level warns', async () => {
    const { session } = await loadedSession(capabilitiesWith({ level: 'approximated' }));
    await expect(session.setGlobalLevel(0.5)).resolves.toEqual({ warnings: [] });
    await expect(session.clearGlobalLevel()).resolves.toEqual({ warnings: [] });
    await expect(session.setTrackLevel('track.lead', 0.5)).resolves.toMatchObject({
      warnings: [
        expect.objectContaining({
          intent: 'level',
          support: 'approximated',
          trackId: 'track.lead'
        })
      ]
    });
  });

  it('unsubscribes cleanly', async () => {
    const { session } = await loadedSession();
    const seen: SessionState[] = [];
    const off = session.on('state', (s) => seen.push(s));
    off();
    await session.setGlobalFlavor('warm');
    expect(seen).toHaveLength(0);
  });

  it('isolates throwing warning, state, and diagnostic subscribers', async () => {
    const warningSource = SOURCE.replace('tempo 120', 'tempo 120\ntempo 100');
    const wiring = createFakeWiring(undefined, capabilitiesWith({ tempo: 'unsupported' }));
    const session = await createSession(wiring);
    const seen = { warning: 0, state: 0, diagnostic: 0 };
    for (const event of ['warning', 'state', 'diagnostic'] as const) {
      session.on(event, () => {
        throw new Error(`${event} observer failed`);
      });
      session.on(event, () => {
        seen[event] += 1;
      });
    }

    await expect(session.loadSource(warningSource)).resolves.toMatchObject({
      warnings: [expect.objectContaining({ intent: 'tempo' })]
    });
    expect(seen).toEqual({ warning: 1, state: 1, diagnostic: 1 });
    await expect(session.setGlobalFlavor('warm')).resolves.toBeDefined();
  });
});

describe('renderer config window', () => {
  it('reads model info and capabilities', async () => {
    const { session } = await loadedSession();
    expect(session.renderer.getModelInfo().modelId).toBe('fake-1');
    expect(session.renderer.getCapabilities().intents.flavor).toBe('supported');
  });

  it('allows config edits while stopped', async () => {
    const { session } = await loadedSession();
    const defaults = await session.renderer.updateDefaults({ tempo: 100 });
    expect(defaults.tempo).toBe(100);
  });

  it('rejects config edits while active', async () => {
    const { session } = await loadedSession();
    await session.play();
    await expect(session.renderer.updateDefaults({ tempo: 100 })).rejects.toBeInstanceOf(
      GasOperationError
    );
  });
});

describe('close', () => {
  it('closes the Renderer and rejects further work', async () => {
    const { wiring, session } = await loadedSession();
    await session.close();
    expect(wiring.current().closes).toBe(1);
    expect(session.getState().lifecycle).toBe('closed');
    await expect(session.play()).rejects.toBeInstanceOf(GasOperationError);
  });
});
