import { describe, expect, it } from 'vitest';
import {
  createSession,
  GasOperationError,
  sourceBlob,
  type SessionState
} from '../../src/api/index.js';
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
    expect(updates[0]?.appValues).toEqual([{ kind: 'setGlobalFlavor', value: 'warm and distant' }]);
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

  // A live submission yields while it resolves its source and loads the
  // compiler. A programmatic command accepted in that window must survive the
  // submission's own commit. The source is gated rather than timed, so the case
  // holds however many times the implementation awaits.
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

describe('app values', () => {
  it('a value set before Play equals the same value set during Play', async () => {
    const before = await loadedSession();
    await before.session.setTrackLevel('track.drums', 0.4);
    await before.session.play();

    const during = await loadedSession();
    await during.session.play();
    await during.session.setTrackLevel('track.drums', 0.4);

    expect(before.session.getState().appValues).toEqual(during.session.getState().appValues);
    expect(before.wiring.current().updates.at(-1)).toEqual(during.wiring.current().updates.at(-1));
  });

  it('getState().appValues round-trips through apply', async () => {
    const first = await loadedSession();
    await first.session.defineTrack({ id: 'app.bells', name: 'bells' });
    await first.session.playTrack('app.bells');
    await first.session.setTrackLevel('track.drums', 0.4);
    await first.session.setTempo(100);
    await first.session.setTrackLevel('track.drums', 0.6);
    const saved = first.session.getState().appValues;
    expect(saved).toEqual([
      { kind: 'defineTrack', id: 'app.bells', name: 'bells' },
      { kind: 'playTrack', trackId: 'app.bells' },
      { kind: 'setTempo', bpm: 100 },
      { kind: 'setTrackLevel', trackId: 'track.drums', value: 0.6 }
    ]);

    const second = await loadedSession();
    await second.session.apply(saved);
    expect(second.session.getState().appValues).toEqual(saved);
    expect(second.session.getTracks()).toEqual(first.session.getTracks());
  });

  it('apply forwards once and applies nothing when one command fails', async () => {
    const { wiring, session } = await loadedSession();
    await session.apply([
      { kind: 'setTempo', bpm: 100 },
      { kind: 'setGlobalFlavor', value: 'dusk' }
    ]);
    expect(wiring.current().updates).toHaveLength(1);

    await expect(
      session.apply([
        { kind: 'setTempo', bpm: 140 },
        { kind: 'playTrack', trackId: 'ghost' }
      ])
    ).rejects.toMatchObject({ kind: 'command', failure: { code: 'unknown-track' } });
    expect(wiring.current().updates).toHaveLength(1);
    expect(session.getState().appValues).toEqual([
      { kind: 'setTempo', bpm: 100 },
      { kind: 'setGlobalFlavor', value: 'dusk' }
    ]);
  });

  it('clearAppValues removes app tracks and values and keeps the document', async () => {
    const { wiring, session } = await loadedSession();
    await session.defineTrack({ id: 'app.bells' });
    await session.setTempo(100);
    await session.clearAppValues();
    expect(session.getState().appValues).toEqual([]);
    expect(session.getTracks().map((t) => t.id)).toEqual(['track.drums', 'track.lead']);
    expect(wiring.current().updates.at(-1)?.appValues).toEqual([]);
  });

  it('clears play, notes and motif, and removes app tracks', async () => {
    const { session } = await loadedSession();
    await session.defineTrack({ id: 'app.bells' });
    await session.stopTrack('track.drums');
    await session.clearTrackPlay('track.drums');
    await session.apply([
      { kind: 'setTrackNotes', trackId: 'track.lead', alda: 'c d e' },
      { kind: 'setTrackMotif', trackId: 'track.lead', alda: 'g2' }
    ]);
    await session.clearTrackNotes('track.lead');
    await session.clearTrackMotif('track.lead');
    await session.setTrackLevel('app.bells', 0.3);
    await session.removeTrack('app.bells');
    expect(session.getState().appValues).toEqual([]);
    await expect(session.removeTrack('track.drums')).rejects.toMatchObject({
      failure: { code: 'not-app-track' }
    });
  });

  it('loadSource keeps app values by default and warns about dropped ones', async () => {
    const { session } = await loadedSession();
    await session.setTempo(100);
    await session.setTrackLevel('track.drums', 0.4);
    const warnings: string[] = [];
    session.on('warning', (warning) => warnings.push(warning.warningId));
    const result = await session.loadSource(OTHER_SOURCE);
    expect(session.getState().appValues).toEqual([{ kind: 'setTempo', bpm: 100 }]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'app-value-dropped', trackId: 'track.drums' })
    ]);
    expect(warnings).toEqual(result.warnings.map((warning) => warning.warningId));
  });

  it("loadSource with 'clear' starts with no app values", async () => {
    const { session } = await loadedSession();
    await session.setTempo(100);
    await session.loadSource(OTHER_SOURCE, { appValues: 'clear' });
    expect(session.getState().appValues).toEqual([]);
  });

  it('loadSource with a command list replaces the app values', async () => {
    const { wiring, session } = await loadedSession();
    await session.setTempo(100);
    await session.loadSource(OTHER_SOURCE, {
      appValues: [{ kind: 'setTrackLevel', trackId: 'track.pad', value: 0.2 }]
    });
    expect(session.getState().appValues).toEqual([
      { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.2 }
    ]);
    expect(wiring.current().loads.at(-1)?.inputState.appValues).toEqual([
      { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.2 }
    ]);
  });

  it('applies saved app values back onto the same session', async () => {
    const { session } = await loadedSession();
    await session.defineTrack({ id: 'app.bells', name: 'bells' });
    await session.playTrack('app.bells');
    await session.setTrackLevel('track.drums', 0.4);
    const saved = session.getState().appValues;
    await session.setTrackLevel('track.drums', 0.9);
    await session.apply(saved);
    expect(session.getState().appValues).toEqual(saved);
  });

  it("a keep load rejects when the new document declares an app track's id", async () => {
    const { wiring, session } = await loadedSession();
    await session.defineTrack({ id: 'track.pad', name: 'my pad' });
    await session.setTempo(100);
    await expect(session.loadSource(OTHER_SOURCE)).rejects.toMatchObject({
      kind: 'command',
      failure: { code: 'duplicate-track', trackId: 'track.pad' }
    });
    expect(wiring.current().loads).toHaveLength(1);
    expect(session.getTracks().map((t) => t.id)).toEqual([
      'track.drums',
      'track.lead',
      'track.pad'
    ]);
    expect(session.getState().appValues).toEqual([
      { kind: 'defineTrack', id: 'track.pad', name: 'my pad' },
      { kind: 'setTempo', bpm: 100 }
    ]);
  });

  it('rejects commands while a document is loading', async () => {
    const { session } = await loadedSession();
    const next = (await session.compileSource(OTHER_SOURCE)).timeline;
    const [load, command] = await Promise.allSettled([
      session.loadTimeline(next),
      session.setGlobalFlavor('warm')
    ]);
    expect(load.status).toBe('fulfilled');
    expect(command).toMatchObject({ status: 'rejected', reason: { kind: 'lifecycle' } });
    expect(session.getTracks().map((t) => t.id)).toEqual(['track.pad']);
    expect(session.getState().appValues).toEqual([]);
    await session.setGlobalFlavor('warm');
    expect(session.getState().appValues).toEqual([{ kind: 'setGlobalFlavor', value: 'warm' }]);
  });

  it('rejects a second load while one is pending', async () => {
    const { session } = await loadedSession();
    const [first, second] = await Promise.allSettled([
      session.loadSource(OTHER_SOURCE),
      session.loadSource(OTHER_SOURCE)
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(['fulfilled', 'rejected']);
  });

  it('accepts commands again after a failed load', async () => {
    const { wiring, session } = await loadedSession();
    wiring.current().failLoad = true;
    await expect(session.loadSource(OTHER_SOURCE)).rejects.toBeInstanceOf(GasOperationError);
    wiring.current().failLoad = false;
    await session.setTempo(100);
    expect(session.getState().appValues).toEqual([{ kind: 'setTempo', bpm: 100 }]);
  });

  it('a failing command list rejects the load and keeps the old document', async () => {
    const { wiring, session } = await loadedSession();
    await session.setTempo(100);
    await expect(
      session.loadSource(OTHER_SOURCE, {
        appValues: [{ kind: 'setTrackLevel', trackId: 'track.drums', value: 0.2 }]
      })
    ).rejects.toMatchObject({ kind: 'command', failure: { code: 'unknown-track' } });
    expect(wiring.current().loads).toHaveLength(1);
    expect(session.getTracks().map((t) => t.id)).toEqual(['track.drums', 'track.lead']);
    expect(session.getState().appValues).toEqual([{ kind: 'setTempo', bpm: 100 }]);
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
        code: 'lyria-rt-auth',
        message: 'renderer-safe message',
        reason: 'auth',
        retryable: false
      }
    });
    wiring.current().startError = thrown;

    await expect(session.play()).rejects.toMatchObject({
      message: 'The Renderer failed to start.',
      code: 'lyria-rt-auth',
      reason: 'auth',
      retryable: false
    });
  });

  it('stop is safe when already stopped and keeps app values', async () => {
    const { wiring, session } = await loadedSession();
    await session.play();
    await session.setGlobalFlavor('warm');
    await session.stop();
    expect(session.getState().playback).toBe('stopped');
    const last = wiring.current().updates.at(-1);
    expect(last?.appValues).toEqual([{ kind: 'setGlobalFlavor', value: 'warm' }]);
    expect(session.getState().appValues).toEqual([{ kind: 'setGlobalFlavor', value: 'warm' }]);
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

  it('keeps app values when the piece finishes', async () => {
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
    expect(session.getState().appValues).toEqual([{ kind: 'setGlobalFlavor', value: 'warm' }]);
    await session.play();
    expect(session.getState().playback).toBe('active');
    await session.setGlobalFlavor('cool');
    expect(wiring.current().updates.at(-1)?.appValues).toEqual([
      { kind: 'setGlobalFlavor', value: 'cool' }
    ]);
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
      code: 'lyria-rt-network-failure',
      message: 'The connector lost its connection.',
      reason: 'network',
      runId: 'run-1',
      retryable: true,
      closeCode: 4429
    });
    expect(errors.at(-1)).toMatchObject({ code: 'lyria-rt-network-failure', closeCode: 4429 });
  });

  it('carries a transport close code out of a failed start', async () => {
    // The thrown RendererError is read structurally, so its nested failure has to
    // survive the trip without the API importing the Renderer.
    const session = await createSession(
      createFakeWiring((renderer) => {
        renderer.startError = Object.assign(new Error('start rejected'), {
          failure: {
            code: 'lyria-rt-auth-rejected',
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
    expect(caught).toMatchObject({ code: 'lyria-rt-auth-rejected', closeCode: 1008 });
  });

  it('drops a close code no transport could have produced', async () => {
    const { wiring, session } = await loadedSession();
    const errors: GasOperationError[] = [];
    session.on('error', (error) => errors.push(error));
    await session.play();

    wiring.current().emitFailure({
      code: 'lyria-rt-network-failure',
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
      code: 'lyria-rt-auth',
      message: 'The connector reported an authentication failure.',
      reason: 'auth',
      retryable: false
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      kind: 'renderer',
      code: 'lyria-rt-auth',
      reason: 'auth',
      retryable: false
    });
  });

  it('keeps app tracks and app values, and reloads a fresh Renderer', async () => {
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
    const reloaded = fresh.loads[0]!.inputState;
    expect(reloaded.appTracks.map((t) => t.id)).toEqual(['track.bass']);
    expect(reloaded.appValues).toEqual([{ kind: 'setGlobalFlavor', value: 'warm' }]);
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

// A Play that settles after Stop, Close or a renderer replacement belongs to a
// run the host already abandoned; it must not move the session.
describe('pending play ownership', () => {
  function gated(session: Awaited<ReturnType<typeof loadedSession>>) {
    let release!: () => void;
    let fail!: (error: unknown) => void;
    session.wiring.current().startGate = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    return { release: () => release(), fail: (error: unknown) => fail(error) };
  }

  it.each([
    ['succeeds', true],
    ['rejects', false]
  ] as const)('stays stopped and reports nothing when Play %s after Stop', async (_label, ok) => {
    const loaded = await loadedSession();
    const gate = gated(loaded);
    const errors: unknown[] = [];
    loaded.session.on('error', (error) => errors.push(error));
    const play = loaded.session.play();
    await Promise.resolve();

    await loaded.session.stop();
    if (ok) gate.release();
    else gate.fail(new Error('late start failure'));
    await expect(play).rejects.toBeInstanceOf(GasOperationError);

    expect(errors).toEqual([]);
    expect(loaded.session.getState()).toMatchObject({ lifecycle: 'ready', playback: 'stopped' });
    expect(loaded.session.getState().runId).toBeUndefined();
    // A run the renderer started for nobody is stopped again.
    expect(loaded.wiring.current().stops).toBe(ok ? 2 : 1);
  });

  it.each([
    ['before', true],
    ['after', false]
  ] as const)(
    'leaves a newer Play alone when the abandoned one settles %s it',
    async (_label, olderFirst) => {
      const loaded = await loadedSession();
      const older = gated(loaded);
      const first = loaded.session.play();
      await Promise.resolve();
      await loaded.session.stop();

      const newer = gated(loaded);
      const second = loaded.session.play();
      await Promise.resolve();
      if (olderFirst) older.release();
      newer.release();
      await second;
      if (!olderFirst) older.release();
      await expect(first).rejects.toBeInstanceOf(GasOperationError);

      expect(loaded.wiring.current().stops).toBe(1);
      expect(loaded.session.getState().playback).toBe('active');
    }
  );

  it('stays closed when Play settles after Close', async () => {
    const loaded = await loadedSession();
    const gate = gated(loaded);
    const errors: unknown[] = [];
    loaded.session.on('error', (error) => errors.push(error));
    const play = loaded.session.play();
    await Promise.resolve();

    await loaded.session.close();
    gate.fail(new Error('late start failure'));
    await expect(play).rejects.toBeInstanceOf(GasOperationError);

    expect(errors).toEqual([]);
    expect(loaded.session.getState()).toMatchObject({ lifecycle: 'closed', playback: 'stopped' });
  });

  it('keeps an old renderer result off its replacement', async () => {
    const loaded = await loadedSession();
    const gate = gated(loaded);
    const play = loaded.session.play();
    await Promise.resolve();

    await loaded.session.retryRenderer();
    gate.fail(new Error('late start failure'));
    await expect(play).rejects.toBeInstanceOf(GasOperationError);

    expect(loaded.wiring.renderers).toHaveLength(2);
    expect(loaded.session.getState()).toMatchObject({ lifecycle: 'ready', playback: 'stopped' });
    await loaded.session.play();
    expect(loaded.session.getState().playback).toBe('active');
  });
});
