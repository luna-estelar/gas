// Rule 5 at session level: app values last through Stop, a finished piece and a
// failure, and each new connection starts from them.
// Skipped until GAS 0.4 step 4 implements the session these describe.
import { describe, expect, it } from 'vitest';
import type { Command, EffectiveState } from '../../../src/protocol/index.js';
import { ConnectorError } from '../../../src/protocol/index.js';
import { flushAsync } from '../../../../../test/support/deferred.js';
import { PAD, PLAYS_AT_ONCE, barTime, harness, playing, type Harness } from './support/harness.js';

const BEFORE: Command = { kind: 'setTrackLevel', trackId: PAD, value: 0.3 };
const DURING: Command = { kind: 'setTrackFlavor', trackId: PAD, value: 'brighter' };

function padIn(state: EffectiveState) {
  return state.tracks.find((track) => track.trackId === PAD);
}

async function expectKept(h: Harness): Promise<void> {
  expect(h.session.getState().appValues).toEqual([BEFORE, DURING]);
  await h.session.play();
  const pad = padIn(h.connector.connects.at(-1)!.state);
  expect(pad?.level).toEqual({ kind: 'level', value: 0.3 });
  expect(pad?.flavor).toMatchObject({ value: 'brighter' });
}

async function withValues(source?: string): Promise<Harness> {
  const h = await harness(source !== undefined ? { source } : {});
  await h.session.apply([BEFORE]);
  await h.session.play();
  h.connector.latest().pushAudio(2);
  await h.session.apply([DURING]);
  return h;
}

describe.skip('app values', () => {
  it('reach the first connection', async () => {
    const h = await harness();
    await h.session.apply([BEFORE]);
    await h.session.play();

    expect(padIn(h.connector.connects[0]!.state)?.level).toEqual({ kind: 'level', value: 0.3 });
  });

  it('last through Stop', async () => {
    const h = await withValues();
    await h.session.stop();
    await expectKept(h);
  });

  it('last through a finished piece', async () => {
    const h = await withValues(PLAYS_AT_ONCE);
    h.connector.latest().pushAudio(barTime(5) - 2);
    await h.advanceTo(barTime(5) + 1);
    expect(h.session.getState()).toMatchObject({ status: 'stopped', ended: 'finished' });
    await expectKept(h);
  });

  it('last through a failure', async () => {
    const h = await withValues();
    h.connector
      .latest()
      .fail(new ConnectorError({ code: 'socket-closed', reason: 'network', retryable: true }));
    await flushAsync();
    expect(h.session.getState().ended).toBe('failed');
    await expectKept(h);
  });

  it('go only when the app clears them', async () => {
    const h = await playing();
    await h.session.apply([BEFORE]);
    await h.session.stop();
    await h.session.clearAppValues();
    expect(h.session.getState().appValues).toEqual([]);

    await h.session.play();
    expect(padIn(h.connector.connects.at(-1)!.state)?.level).toBeUndefined();
  });

  it('win over the score when set before Play', async () => {
    const h = await harness();
    await h.session.apply([{ kind: 'stopTrack', trackId: PAD }]);
    await h.session.play();

    // The score plays the pad at bar 1; the app value keeps it stopped.
    expect(padIn(h.connector.connects[0]!.state)?.active).toBe(false);
  });
});
