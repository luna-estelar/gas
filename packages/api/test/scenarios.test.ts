// Exercise session validation, lifecycle and live commands through the public API.

import { describe, expect, it } from 'vitest';
import { createSession, GasOperationError } from '../src/index.js';
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

async function loaded(caps = capabilities()) {
  const wiring = createFakeWiring(undefined, caps);
  const session = await createSession(wiring);
  await session.loadSource(SOURCE);
  return { wiring, session };
}

describe('live commands', () => {
  it('applies a fragment against authored tracks', async () => {
    const { wiring, session } = await loaded();
    const result = await session.submitLiveCommands('drums.flavor "punchy"\ntempo 132');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.applied).toBe(2);
    // The session is stopped, so overrides stage (Core routes by phase); they
    // would land in `live` if applied during playback.
    const forwarded = wiring.current().updates.at(-1);
    expect(forwarded?.staged).toEqual([
      { kind: 'setTrackFlavor', trackId: 'track.drums', value: 'punchy' },
      { kind: 'setTempo', bpm: 132 }
    ]);
  });

  it('routes live overrides to the live layer during playback', async () => {
    const { wiring, session } = await loaded();
    await session.play();
    await session.submitLiveCommands('drums.flavor "punchy"');
    const forwarded = wiring.current().updates.at(-1);
    expect(forwarded?.live).toEqual([
      { kind: 'setTrackFlavor', trackId: 'track.drums', value: 'punchy' }
    ]);
    expect(forwarded?.staged).toEqual([]);
  });

  it('declares a track live and keeps it addressable afterwards (persistent declaration)', async () => {
    const { session } = await loaded();
    const first = await session.submitLiveCommands('track echo "spacey delay"\necho.play');
    expect(first.ok).toBe(true);
    expect(session.getTracks().some((t) => t.id === 'track.echo')).toBe(true);
    // A later, separate submission still resolves the live-declared track.
    const second = await session.submitLiveCommands('echo.flavor "wet"');
    expect(second.ok).toBe(true);
  });

  it('resolves references made before a live declaration within the same batch', async () => {
    const { wiring, session } = await loaded();
    await session.submitLiveCommands('track echo "spacey"\necho.level 0.5');
    const forwarded = wiring.current().updates.at(-1);
    expect(forwarded?.hostTracks.map((t) => t.id)).toEqual(['track.echo']);
    expect(forwarded?.staged).toEqual([
      { kind: 'setTrackLevel', trackId: 'track.echo', value: 0.5 }
    ]);
  });

  it('is partial-success: earlier statements commit, a later failure resolves with a payload', async () => {
    const { session } = await loaded();
    const result = await session.submitLiveCommands('track echo "spacey"\necho.play\nghost.play');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.applied).toBe(2);
      expect(result.failure.code).toBe('unknown-track');
    }
    // The committed declaration persists despite the later failure.
    expect(session.getTracks().some((t) => t.id === 'track.echo')).toBe(true);
  });

  it('rejects when nothing commits before the failure', async () => {
    const { session } = await loaded();
    await expect(session.submitLiveCommands('ghost.play')).rejects.toBeInstanceOf(
      GasOperationError
    );
  });

  it('rejects the whole submission on a structural error before any statement runs', async () => {
    const { wiring, session } = await loaded();
    await expect(session.submitLiveCommands('chorus()')).rejects.toBeInstanceOf(GasOperationError);
    expect(wiring.current().updates).toHaveLength(0);
  });
});

describe('session validation scenarios', () => {
  it('compile-and-play', async () => {
    const { wiring, session } = await loaded();
    await session.play();
    expect(session.getState().playback).toBe('active');
    expect(wiring.current().starts).toBe(1);
    await session.stop();
    expect(session.getState().playback).toBe('stopped');
  });

  it('load a precompiled timeline', async () => {
    const wiring = createFakeWiring();
    const session = await createSession(wiring);
    const compiled = await session.compileSource(SOURCE);
    await session.loadTimeline(compiled.timeline);
    expect(session.getState().timelineLoaded).toBe(true);
    expect(session.getTracks().map((t) => t.id)).toEqual(['track.drums', 'track.lead']);
    expect(wiring.current().loads).toHaveLength(1);
  });

  it('rejects an invalid precompiled timeline before any Renderer call', async () => {
    const wiring = createFakeWiring();
    const session = await createSession(wiring);
    const bogus = { formatVersion: { major: 1, minor: 0 } } as never;
    await expect(session.loadTimeline(bogus)).rejects.toBeInstanceOf(GasOperationError);
    expect(wiring.current().loads).toHaveLength(0);
  });

  it('programmatic track lifecycle', async () => {
    const { wiring, session } = await loaded();
    await session.defineTrack({ id: 'track.bass', name: 'bass', description: 'deep bass' });
    expect(session.getTracks().some((t) => t.id === 'track.bass' && t.source === 'host')).toBe(
      true
    );
    await session.playTrack('track.bass');
    await session.stopTrack('track.bass');
    const forwarded = wiring.current().updates.at(-1);
    expect(forwarded?.staged.at(-1)).toEqual({ kind: 'stopTrack', trackId: 'track.bass' });
  });

  it('live fragments with persistent declarations', async () => {
    const { session } = await loaded();
    await session.submitLiveCommands('track pluck "muted pluck"\npluck.play');
    const again = await session.submitLiveCommands('pluck.level 0.7');
    expect(again.ok).toBe(true);
  });

  it('tempo change during playback surfaces requested/applied positions', async () => {
    const { wiring, session } = await loaded();
    await session.play();
    wiring.current().updateResult = { requestedPosition: { bar: 2 }, appliedPosition: { bar: 5 } };
    const result = await session.setTempo(90);
    expect(result.requestedPosition).toEqual({ bar: 2 });
    expect(result.appliedPosition).toEqual({ bar: 5 });
  });

  it('unsupported-intent command warns exactly once', async () => {
    const { session } = await loaded(capabilitiesWith({ timbre: 'unsupported' }));
    const warnings: string[] = [];
    session.on('warning', (w) => warnings.push(w.warningId));
    const result = await session.setTrackTimbre('track.lead', 'detuned tape piano');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('unsupported-intent');
    expect(warnings).toEqual([result.warnings[0]?.warningId]);
  });
});
