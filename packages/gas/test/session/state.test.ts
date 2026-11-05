// `SessionState`: one `status`, `ended` saying how the last Play finished, and
// one `state` event per change. Plus the `generationPosition` events.
// Skipped until GAS 0.4 step 4 implements the session these describe.
import { describe, expect, it } from 'vitest';
import { ConnectorError } from '../../src/protocol/index.js';
import { flushAsync } from '../../../../test/support/deferred.js';
import { PLAYS_AT_ONCE, barTime, harness, playing } from './support/harness.js';

describe.skip('session state', () => {
  it('starts stopped, with nothing loaded and no ended', async () => {
    const h = await harness({ source: null });
    const state = h.session.getState();

    expect(state).toEqual({ status: 'stopped', loaded: false, tracks: [], appValues: [] });
    expect('ended' in state).toBe(false);
  });

  it('reports loading as a state change', async () => {
    const h = await harness({ source: null });
    await h.session.loadSource(PLAYS_AT_ONCE);

    expect(h.states).toHaveLength(1);
    expect(h.states[0]).toMatchObject({ status: 'stopped', loaded: true });
  });

  it('goes starting, playing, stopped for Play and Stop', async () => {
    const h = await harness();
    h.states.length = 0;
    await h.session.play();
    await h.session.stop();

    expect(h.statuses()).toEqual(['starting', 'playing', 'stopped']);
    expect(h.states.at(-1)?.ended).toBe('stopped');
  });

  it('ends finished when a finite piece reaches its end', async () => {
    const h = await harness({ source: PLAYS_AT_ONCE });
    await h.session.play();
    h.connector.latest().pushAudio(barTime(5));
    h.states.length = 0;
    await h.advanceTo(barTime(5) + 1);

    expect(h.statuses()).toEqual(['stopped']);
    expect(h.session.getState().ended).toBe('finished');
  });

  it('ends failed after a failure', async () => {
    const h = await playing();
    h.states.length = 0;
    h.connector
      .latest()
      .fail(new ConnectorError({ code: 'socket-closed', reason: 'network', retryable: true }));
    await flushAsync();

    expect(h.statuses()).toEqual(['stopped']);
    expect(h.states[0]?.ended).toBe('failed');
  });

  it('ends closed when Close comes during Play', async () => {
    const h = await playing();
    h.states.length = 0;
    await h.session.close();

    expect(h.statuses().at(-1)).toBe('closed');
    expect(h.statuses()).not.toContain('playing');
  });

  it('goes starting, stopped for a cancelled start', async () => {
    const h = await harness();
    h.connector.autoConnect = false;
    h.states.length = 0;
    const play = h.session.play().catch(() => undefined);
    await flushAsync();
    await h.session.stop();
    await play;

    expect(h.statuses()).toEqual(['starting', 'stopped']);
  });

  it('keeps ended from the last Play until the next one ends', async () => {
    const h = await playing();
    await h.session.stop();
    h.states.length = 0;
    await h.session.play();

    expect(h.states.map((state) => state.ended)).toEqual(['stopped', 'stopped']);
  });

  it('never emits the same state twice in a row', async () => {
    const h = await playing();
    await h.session.setTrackLevel('track.pad', 0.5);
    await h.session.stop();
    await h.session.stop();
    await h.session.play();
    await h.session.close();

    for (let index = 1; index < h.states.length; index += 1) {
      expect(h.states[index]).not.toEqual(h.states[index - 1]);
    }
  });

  it('reports an app value change as a state change', async () => {
    const h = await harness();
    h.states.length = 0;
    await h.session.setTrackLevel('track.pad', 0.5);

    expect(h.states).toHaveLength(1);
    expect(h.states[0]?.appValues).toEqual([
      { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.5 }
    ]);
  });

  it('reports where the model has generated to, with no run id', async () => {
    const h = await playing();
    h.connector.latest().pushAudio(4);
    await h.advanceTo(barTime(3));

    expect(h.positions.length).toBeGreaterThan(1);
    for (const position of h.positions) {
      expect(Object.keys(position).sort()).toEqual(['loopIteration', 'position', 'seconds']);
    }
    expect(h.positions[0]).toEqual({ position: { bar: 1 }, seconds: 0, loopIteration: 1 });
  });

  it('emits no generation position from an old connection', async () => {
    const h = await playing();
    const old = h.connector.latest();
    await h.session.stop();
    const before = h.positions.length;

    old.pushAudio(4);
    await h.advanceTo(10);
    expect(h.positions.length).toBe(before);
  });
});
