// Exercise live commands and whole-session scenarios through the public API.

import { describe, expect, it } from 'vitest';
import { GasOperationError } from '../../src/api/index.js';
import type { EffectiveState, IntentKeyword, IntentSupport } from '../../src/protocol/index.js';
import { fakeDescription } from '../../../../test/support/fake-connection.js';
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

function loaded(options: HarnessOptions = {}) {
  return harness({ source: SOURCE, ...options });
}

type Loaded = Awaited<ReturnType<typeof loaded>>;

/** Plays, so commands reach the connection as updates. */
async function playingLoaded(): Promise<Loaded> {
  const h = await loaded();
  await h.session.play();
  return h;
}

function lastSent(h: Loaded): EffectiveState | undefined {
  return h.connector.latest().updates.at(-1)?.update.state;
}

function track(state: EffectiveState | undefined, id: string) {
  return state?.tracks.find((entry) => entry.trackId === id);
}

describe('live commands', () => {
  it('applies a fragment against authored tracks', async () => {
    const h = await playingLoaded();
    const result = await h.session.submitLiveCommands('drums.flavor "punchy"\ntempo 132');
    expect(result).toMatchObject({ applied: 2 });
    expect(h.session.getState().appValues).toEqual([
      { kind: 'setTrackFlavor', trackId: 'track.drums', value: 'punchy' },
      { kind: 'setTempo', bpm: 132 }
    ]);
    const sent = lastSent(h);
    expect(track(sent, 'track.drums')?.flavor).toEqual({ kind: 'text', text: 'punchy' });
    expect(sent?.globals.tempo).toBe(132);
  });

  it('stores a value the same way before and during playback', async () => {
    const before = await loaded();
    await before.session.submitLiveCommands('drums.flavor "punchy"');
    await before.session.play();

    const during = await playingLoaded();
    await during.session.submitLiveCommands('drums.flavor "punchy"');

    expect(during.session.getState().appValues).toEqual(before.session.getState().appValues);
    expect(lastSent(during)).toEqual(before.connector.connects[0]?.state);
  });

  it('declares a track live and keeps it addressable afterwards', async () => {
    const { session } = await loaded();
    const first = await session.submitLiveCommands('track echo "spacey delay"\necho.play');
    expect(first.applied).toBe(2);
    expect(session.getTracks().some((t) => t.id === 'track.echo')).toBe(true);
    // A later, separate submission still resolves the live-declared track.
    const second = await session.submitLiveCommands('echo.flavor "wet"');
    expect(second.applied).toBe(1);
  });

  it('resolves references made after a live declaration within the same batch', async () => {
    const h = await playingLoaded();
    await h.session.submitLiveCommands('track echo "spacey"\necho.level 0.5');
    expect(h.session.getState().appValues).toEqual([
      { kind: 'defineTrack', id: 'track.echo', name: 'echo', description: 'spacey' },
      { kind: 'setTrackLevel', trackId: 'track.echo', value: 0.5 }
    ]);
    expect(track(lastSent(h), 'track.echo')?.level).toEqual({ kind: 'level', value: 0.5 });
  });

  it('applies nothing and rejects when a later statement fails', async () => {
    const h = await playingLoaded();
    const failed = h.session.submitLiveCommands('track echo "spacey"\necho.play\nghost.play');
    await expect(failed).rejects.toMatchObject({
      kind: 'command',
      failure: { code: 'unknown-track' }
    });
    expect(h.session.getTracks().some((t) => t.id === 'track.echo')).toBe(false);
    expect(h.session.getState().appValues).toEqual([]);
    expect(h.connector.latest().updates).toHaveLength(0);
  });

  it('rejects a single failing statement', async () => {
    const { session } = await loaded();
    await expect(session.submitLiveCommands('ghost.play')).rejects.toBeInstanceOf(
      GasOperationError
    );
  });

  it('clears track and global values, and the score takes over again', async () => {
    const h = await playingLoaded();
    await h.session.submitLiveCommands('drums.flavor "punchy"\nflavor "dusk"\ntempo 132');
    expect(lastSent(h)?.globals).toMatchObject({
      flavor: { kind: 'text', text: 'dusk' },
      tempo: 132
    });

    const result = await h.session.submitLiveCommands(
      'drums.flavor clear\nflavor clear\ntempo clear'
    );
    expect(result.applied).toBe(3);
    expect(h.session.getState().appValues).toEqual([]);
    const sent = lastSent(h);
    expect(track(sent, 'track.drums')?.flavor).toBeUndefined();
    expect(sent?.globals.flavor).toBeUndefined();
    expect(sent?.globals.tempo).toBe(120);
  });

  it('releases a stopped track back to the score', async () => {
    const h = await playingLoaded();
    await h.session.submitLiveCommands('lead.stop');
    expect(track(lastSent(h), 'track.lead')?.active).toBe(false);
    await h.session.submitLiveCommands('lead.release');
    expect(h.session.getState().appValues).toEqual([]);
    expect(track(lastSent(h), 'track.lead')?.active).toBe(true);
  });

  it('removes an app track', async () => {
    const h = await playingLoaded();
    await h.session.submitLiveCommands('track echo "spacey"\necho.play');
    await h.session.submitLiveCommands('track echo clear');
    expect(h.session.getTracks().some((t) => t.id === 'track.echo')).toBe(false);
    expect(h.session.getState().appValues).toEqual([]);
    expect(track(lastSent(h), 'track.echo')).toBeUndefined();
  });

  it('refuses to remove a document track and changes nothing', async () => {
    const h = await playingLoaded();
    await expect(h.session.submitLiveCommands('track drums clear')).rejects.toMatchObject({
      kind: 'command',
      failure: { code: 'not-app-track' }
    });
    expect(h.session.getTracks().some((t) => t.id === 'track.drums')).toBe(true);
    expect(h.connector.latest().updates).toHaveLength(0);
  });

  it('rejects the whole submission on a structural error before any statement runs', async () => {
    const h = await playingLoaded();
    await expect(h.session.submitLiveCommands('chorus()')).rejects.toMatchObject({
      kind: 'command'
    });
    expect(h.connector.latest().updates).toHaveLength(0);
  });
});

describe('session validation scenarios', () => {
  it('compile-and-play', async () => {
    const h = await loaded();
    await h.session.play();
    expect(h.session.getState().status).toBe('playing');
    expect(h.connector.connects).toHaveLength(1);
    await h.session.stop();
    expect(h.session.getState()).toMatchObject({ status: 'stopped', ended: 'stopped' });
  });

  it('defines, uses and removes an app track', async () => {
    const h = await playingLoaded();
    await h.session.defineTrack({ id: 'track.bass', name: 'bass', description: 'deep bass' });
    expect(h.session.getTracks().some((t) => t.id === 'track.bass' && t.source === 'app')).toBe(
      true
    );
    await h.session.playTrack('track.bass');
    expect(track(lastSent(h), 'track.bass')?.active).toBe(true);
    await h.session.stopTrack('track.bass');
    // stopTrack replaces playTrack: one value per slot.
    expect(h.session.getState().appValues).toEqual([
      { kind: 'defineTrack', id: 'track.bass', name: 'bass', description: 'deep bass' },
      { kind: 'stopTrack', trackId: 'track.bass' }
    ]);
    expect(track(lastSent(h), 'track.bass')?.active).toBe(false);
  });

  it('live fragments with persistent declarations', async () => {
    const { session } = await loaded();
    await session.submitLiveCommands('track pluck "muted pluck"\npluck.play');
    const again = await session.submitLiveCommands('pluck.level 0.7');
    expect(again.applied).toBe(1);
  });

  it('tempo change during playback surfaces requested/applied positions', async () => {
    const h = await playingLoaded();
    h.connector.latest().appliedPosition = { bar: 5 };
    const result = await h.session.setTempo(90);
    expect(result.requestedPosition).toEqual({ bar: 1 });
    expect(result.appliedPosition).toEqual({ bar: 5 });
  });

  it('unsupported-intent command warns exactly once', async () => {
    const support: Partial<Record<IntentKeyword, IntentSupport>> = { timbre: 'unsupported' };
    const intents = { ...fakeDescription().capabilities.intents, ...support };
    const { session, warnings } = await loaded({
      connector: { description: { capabilities: { intents } } }
    });
    const result = await session.setTrackTimbre('track.lead', 'detuned tape piano');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('unsupported-intent');
    expect(warnings.map((w) => w.warningId)).toEqual([result.warnings[0]?.warningId]);
  });
});
