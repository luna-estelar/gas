// Compiling, loading, commands and tracks through the public session API. Play,
// Stop and failures live in ./session/*.
import { describe, expect, it } from 'vitest';
import { GasOperationError, sourceBlob, type SessionState } from '../../src/api/index.js';
import {
  ConnectorError,
  type EffectiveState,
  type IntentKeyword,
  type IntentSupport
} from '../../src/protocol/index.js';
import { fakeDescription } from '../../../../test/support/fake-connection.js';
import { flushAsync } from '../../../../test/support/deferred.js';
import { harness, type HarnessOptions } from './session/support/harness.js';

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

function withCapabilities(
  patch: Partial<Record<IntentKeyword, IntentSupport>>
): Pick<HarnessOptions, 'connector'> {
  const intents = { ...fakeDescription().capabilities.intents, ...patch };
  return { connector: { description: { capabilities: { intents } } } };
}

function loadedSession(options: HarnessOptions = {}) {
  return harness({ source: SOURCE, ...options });
}

function emptySession(options: HarnessOptions = {}) {
  return harness({ source: null, ...options });
}

type Loaded = Awaited<ReturnType<typeof loadedSession>>;

/** The state the open connection last received. */
function lastSent(h: Loaded): EffectiveState | undefined {
  return h.connector.latest().updates.at(-1)?.update.state;
}

function track(state: EffectiveState | undefined, id: string) {
  return state?.tracks.find((entry) => entry.trackId === id);
}

describe('session creation and loading', () => {
  it('starts stopped, with nothing loaded', async () => {
    const { session } = await emptySession();
    expect(session.getState()).toEqual({
      status: 'stopped',
      loaded: false,
      tracks: [],
      appValues: []
    });
    expect(session.getTracks()).toEqual([]);
  });

  it('loadSource compiles, loads, and exposes authored tracks', async () => {
    const { session } = await loadedSession();
    expect(session.getState().loaded).toBe(true);
    expect(session.getTracks()).toEqual([
      { id: 'track.drums', name: 'drums', description: 'Lofi breakbeat', source: 'document' },
      { id: 'track.lead', name: 'lead', description: 'Bright square lead', source: 'document' }
    ]);
  });

  it('compileSource is pure', async () => {
    const { session, states } = await emptySession();
    const compiled = await session.compileSource(SOURCE);
    expect(compiled.timeline.tracks).toHaveLength(2);
    expect(session.getState().loaded).toBe(false);
    expect(states).toEqual([]);
  });

  it('both load methods return authored warnings with the same ids emitted as events', async () => {
    for (const method of ['source', 'timeline'] as const) {
      const { session, warnings } = await emptySession(withCapabilities({ tempo: 'unsupported' }));
      const result =
        method === 'source'
          ? await session.loadSource(SOURCE)
          : await session.loadTimeline((await session.compileSource(SOURCE)).timeline);
      expect(result.warnings).toEqual([
        expect.objectContaining({ intent: 'tempo', support: 'unsupported' })
      ]);
      expect(warnings.map((warning) => warning.warningId)).toEqual(
        result.warnings.map((warning) => warning.warningId)
      );
    }
  });

  it('a compile failure rejects with its diagnostics', async () => {
    const { session } = await emptySession();
    const error = await session.loadSource('ghost_section()').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GasOperationError);
    expect(error).toMatchObject({ kind: 'document' });
    expect((error as GasOperationError).diagnostics.length).toBeGreaterThan(0);
  });

  it('loads a precompiled timeline', async () => {
    const { session } = await emptySession();
    const compiled = await session.compileSource(SOURCE);
    await session.loadTimeline(compiled.timeline);
    expect(session.getState().loaded).toBe(true);
    expect(session.getTracks().map((t) => t.id)).toEqual(['track.drums', 'track.lead']);
  });

  it('rejects an invalid precompiled timeline', async () => {
    const { session, states } = await emptySession();
    const bogus = { formatVersion: { major: 1, minor: 0 } } as never;
    await expect(session.loadTimeline(bogus)).rejects.toMatchObject({ kind: 'document' });
    expect(session.getState().loaded).toBe(false);
    expect(states).toEqual([]);
  });
});

describe('command forwarding', () => {
  it('routes a command through Core and sends the new state to the connection', async () => {
    const h = await loadedSession();
    await h.session.play();
    await h.session.setGlobalFlavor('warm and distant');
    const updates = h.connector.latest().updates;
    expect(updates).toHaveLength(1);
    expect(updates[0]?.update.state.globals.flavor).toEqual({
      kind: 'text',
      text: 'warm and distant'
    });
  });

  it('a command while stopped reaches the next connection', async () => {
    const h = await loadedSession();
    await h.session.setGlobalFlavor('warm');
    expect(h.connector.connects).toEqual([]);
    await h.session.play();
    expect(h.connector.connects[0]?.state.globals.flavor).toEqual({ kind: 'text', text: 'warm' });
  });

  it('a rejected command throws a structured error and sends nothing', async () => {
    const h = await loadedSession();
    await h.session.play();
    await expect(h.session.setTrackFlavor('ghost', 'x')).rejects.toMatchObject({
      kind: 'command'
    });
    expect(h.connector.latest().updates).toHaveLength(0);
  });

  it('carries the positions on a command applied while playing', async () => {
    const h = await loadedSession();
    await h.session.play();
    h.connector.latest().appliedPosition = { bar: 4 };
    const result = await h.session.setTempo(140);
    // Before any audio the Play is still at bar 1.
    expect(result.requestedPosition).toEqual({ bar: 1 });
    expect(result.appliedPosition).toEqual({ bar: 4 });
  });

  it('carries no position on a command applied while stopped', async () => {
    const { session } = await loadedSession();
    const result = await session.setTempo(140);
    expect(result).toEqual({ warnings: [] });
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
    await session.defineTrack({ id: 'app.late', name: 'Late' });
    release();

    expect(await live).toMatchObject({ applied: 1 });
    expect(session.getTracks().map((track) => track.id)).toContain('app.late');
  });
});

describe('atomic replacement', () => {
  it('leaves the previous document unchanged when a compile fails', async () => {
    const { session } = await loadedSession();
    await expect(session.loadSource('ghost_section()')).rejects.toBeInstanceOf(GasOperationError);
    expect(session.getTracks().map((t) => t.id)).toEqual(['track.drums', 'track.lead']);
  });

  it('emits no authored warnings when a load fails', async () => {
    const { session, warnings } = await emptySession(withCapabilities({ tempo: 'unsupported' }));
    await expect(
      session.loadSource(SOURCE.replace('main()', 'ghost_section()'))
    ).rejects.toBeInstanceOf(GasOperationError);
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
    expect(before.connector.connects[0]?.state).toEqual(lastSent(during));
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

  it('apply sends once and applies nothing when one command fails', async () => {
    const h = await loadedSession();
    await h.session.play();
    await h.session.apply([
      { kind: 'setTempo', bpm: 100 },
      { kind: 'setGlobalFlavor', value: 'dusk' }
    ]);
    expect(h.connector.latest().updates).toHaveLength(1);

    await expect(
      h.session.apply([
        { kind: 'setTempo', bpm: 140 },
        { kind: 'playTrack', trackId: 'ghost' }
      ])
    ).rejects.toMatchObject({ kind: 'command', failure: { code: 'unknown-track' } });
    expect(h.connector.latest().updates).toHaveLength(1);
    expect(h.session.getState().appValues).toEqual([
      { kind: 'setTempo', bpm: 100 },
      { kind: 'setGlobalFlavor', value: 'dusk' }
    ]);
  });

  it('clearAppValues removes app tracks and values and keeps the document', async () => {
    const h = await loadedSession();
    await h.session.play();
    await h.session.defineTrack({ id: 'app.bells' });
    await h.session.setTempo(100);
    await h.session.clearAppValues();
    expect(h.session.getState().appValues).toEqual([]);
    expect(h.session.getTracks().map((t) => t.id)).toEqual(['track.drums', 'track.lead']);
    const sent = lastSent(h);
    expect(sent?.globals.tempo).toBe(120);
    expect(track(sent, 'app.bells')).toBeUndefined();
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
    const { session, warnings } = await loadedSession();
    await session.setTempo(100);
    await session.setTrackLevel('track.drums', 0.4);
    const result = await session.loadSource(OTHER_SOURCE);
    expect(session.getState().appValues).toEqual([{ kind: 'setTempo', bpm: 100 }]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'app-value-dropped', trackId: 'track.drums' })
    ]);
    expect(warnings.map((warning) => warning.warningId)).toEqual(
      result.warnings.map((warning) => warning.warningId)
    );
  });

  it("loadSource with 'clear' starts with no app values", async () => {
    const { session } = await loadedSession();
    await session.setTempo(100);
    await session.loadSource(OTHER_SOURCE, { appValues: 'clear' });
    expect(session.getState().appValues).toEqual([]);
  });

  it('loadSource with a command list replaces the app values', async () => {
    const h = await loadedSession();
    await h.session.setTempo(100);
    await h.session.loadSource(OTHER_SOURCE, {
      appValues: [{ kind: 'setTrackLevel', trackId: 'track.pad', value: 0.2 }]
    });
    expect(h.session.getState().appValues).toEqual([
      { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.2 }
    ]);
    await h.session.play();
    const state = h.connector.connects[0]?.state;
    expect(track(state, 'track.pad')?.level).toEqual({ kind: 'level', value: 0.2 });
    expect(state?.globals.tempo).toBe(90);
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
    const { session } = await loadedSession();
    await session.defineTrack({ id: 'track.pad', name: 'my pad' });
    await session.setTempo(100);
    await expect(session.loadSource(OTHER_SOURCE)).rejects.toMatchObject({
      kind: 'command',
      failure: { code: 'duplicate-track', trackId: 'track.pad' }
    });
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
    expect(command).toMatchObject({ status: 'rejected', reason: { kind: 'state' } });
    expect(session.getTracks().map((t) => t.id)).toEqual(['track.pad']);
    expect(session.getState().appValues).toEqual([]);
    await session.setGlobalFlavor('warm');
    expect(session.getState().appValues).toEqual([{ kind: 'setGlobalFlavor', value: 'warm' }]);
  });

  it('rejects a second load while one is pending', async () => {
    const { session } = await loadedSession();
    const next = (await session.compileSource(OTHER_SOURCE)).timeline;
    const [first, second] = await Promise.allSettled([
      session.loadTimeline(next),
      session.loadTimeline(next)
    ]);
    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({ status: 'rejected', reason: { kind: 'state' } });
  });

  it('accepts commands again after a failed load', async () => {
    const { session } = await loadedSession();
    await session.defineTrack({ id: 'track.pad' });
    await expect(session.loadSource(OTHER_SOURCE)).rejects.toBeInstanceOf(GasOperationError);
    await session.setTempo(100);
    expect(session.getState().appValues).toEqual([
      { kind: 'defineTrack', id: 'track.pad' },
      { kind: 'setTempo', bpm: 100 }
    ]);
  });

  it('a failing command list rejects the load and keeps the old document', async () => {
    const { session } = await loadedSession();
    await session.setTempo(100);
    await expect(
      session.loadSource(OTHER_SOURCE, {
        appValues: [{ kind: 'setTrackLevel', trackId: 'track.drums', value: 0.2 }]
      })
    ).rejects.toMatchObject({ kind: 'command', failure: { code: 'unknown-track' } });
    expect(session.getTracks().map((t) => t.id)).toEqual(['track.drums', 'track.lead']);
    expect(session.getState().appValues).toEqual([{ kind: 'setTempo', bpm: 100 }]);
  });
});

describe('provider errors', () => {
  it('carries a transport close code to the app', async () => {
    const h = await loadedSession();
    await h.session.play();
    h.connector.latest().fail(
      new ConnectorError({
        code: 'network-failure',
        reason: 'network',
        retryable: true,
        closeCode: 4429
      })
    );
    await flushAsync();
    expect(h.errors.at(-1)).toMatchObject({ code: 'network-failure', closeCode: 4429 });
  });

  it('drops a close code no transport could have produced', async () => {
    const h = await loadedSession();
    await h.session.play();
    h.connector.latest().fail(
      new ConnectorError({
        code: 'network-failure',
        reason: 'network',
        retryable: true,
        closeCode: 99_999
      })
    );
    await flushAsync();
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).not.toHaveProperty('closeCode');
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
    const { session, warnings } = await loadedSession(withCapabilities({ flavor: 'unsupported' }));
    const result = await session.setGlobalFlavor('warm');
    expect(result.warnings).toHaveLength(1);
    expect(warnings.map((w) => w.warningId)).toEqual([result.warnings[0]?.warningId]);
  });

  it('keeps global level silent while an approximated track level warns', async () => {
    const { session } = await loadedSession(withCapabilities({ level: 'approximated' }));
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

  it('isolates throwing warning and state subscribers', async () => {
    const warningSource = SOURCE.replace('tempo 120', 'tempo 120\ntempo 100');
    const { session } = await emptySession(withCapabilities({ tempo: 'unsupported' }));
    const seen = { warning: 0, state: 0 };
    for (const event of ['warning', 'state'] as const) {
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
    expect(seen).toEqual({ warning: 1, state: 1 });
    await expect(session.setGlobalFlavor('warm')).resolves.toBeDefined();
  });
});

describe('connector info', () => {
  it('reads model info and capabilities', async () => {
    const { session } = await loadedSession(withCapabilities({ flavor: 'approximated' }));
    expect(session.getModelInfo().modelId).toBe('fake-v1');
    expect(session.getCapabilities().intents.flavor).toBe('approximated');
  });
});

describe('close', () => {
  it('closes the connection and rejects further work', async () => {
    const h = await loadedSession();
    await h.session.play();
    await h.session.close();
    expect(h.connector.latest().closed).toBe(true);
    expect(h.session.getState().status).toBe('closed');
    await expect(h.session.play()).rejects.toMatchObject({ kind: 'state' });
  });
});
