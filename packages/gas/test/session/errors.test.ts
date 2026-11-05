// Every failing call rejects with `GasOperationError`, and its `kind` says what
// went wrong. Only a provider failure after Play resolved is an `error` event.
// Skipped until GAS 0.4 step 4 implements the session these describe.
import { describe, expect, it } from 'vitest';
import { GasOperationError } from '../../src/api/index.js';
import { ConnectorError } from '../../src/protocol/index.js';
import { flushAsync } from '../../../../test/support/deferred.js';
import { PAD, PLAYS_AT_ONCE, harness, playing, rejectionOf } from './support/harness.js';

describe.skip('error kinds', () => {
  it('document: a source that does not compile', async () => {
    const h = await harness({ source: null });
    const error = await rejectionOf(h.session.loadSource('track'));

    expect(error).toBeInstanceOf(GasOperationError);
    expect(error.kind).toBe('document');
    expect(error.diagnostics.length).toBeGreaterThan(0);
    expect(h.errors).toEqual([]);
  });

  it('command: an unknown track, with no event', async () => {
    const h = await harness();
    const error = await rejectionOf(h.session.setTrackLevel('track.nope', 0.5));

    expect(error.kind).toBe('command');
    expect(h.errors).toEqual([]);
  });

  it('command: a bad value', async () => {
    const h = await harness();
    const error = await rejectionOf(h.session.setTrackLevel(PAD, Number.NaN));

    expect(error.kind).toBe('command');
  });

  it('command: a group with one bad command, applying none of it', async () => {
    const h = await harness();
    const error = await rejectionOf(
      h.session.apply([
        { kind: 'setTrackLevel', trackId: PAD, value: 0.5 },
        { kind: 'setTrackLevel', trackId: 'track.nope', value: 0.5 }
      ])
    );

    expect(error.kind).toBe('command');
    expect(h.session.getState().appValues).toEqual([]);
  });

  it('state: Play before a document is loaded', async () => {
    const h = await harness({ source: null });
    expect((await rejectionOf(h.session.play())).kind).toBe('state');
    expect(h.connector.connects).toEqual([]);
  });

  it('state: Play while starting or playing', async () => {
    const h = await harness();
    h.connector.autoConnect = false;
    const first = h.session.play();
    await flushAsync();
    expect((await rejectionOf(h.session.play())).kind).toBe('state');

    h.connector.resolveConnect();
    await first;
    expect((await rejectionOf(h.session.play())).kind).toBe('state');
    expect(h.connector.connects).toHaveLength(1);
  });

  it('state: loading a document while playing', async () => {
    const h = await playing();
    expect((await rejectionOf(h.session.loadSource(PLAYS_AT_ONCE))).kind).toBe('state');
  });

  it('state: any call after Close', async () => {
    const h = await harness();
    await h.session.close();

    for (const call of [
      () => h.session.play(),
      () => h.session.loadSource(PLAYS_AT_ONCE),
      () => h.session.setTrackLevel(PAD, 0.5),
      () => h.session.apply([]),
      () => h.session.clearAppValues(),
      () => h.session.stop()
    ]) {
      expect((await rejectionOf(call())).kind).toBe('state');
    }
    expect(h.errors).toEqual([]);
  });

  it('provider: Play rejects when startup fails', async () => {
    const h = await harness();
    h.connector.autoConnect = false;
    const play = h.session.play();
    await flushAsync();
    h.connector.rejectConnect(
      new ConnectorError({ code: 'quota', reason: 'quota', retryable: true, closeCode: 4029 })
    );

    expect(await rejectionOf(play)).toMatchObject({
      kind: 'provider',
      code: 'quota',
      reason: 'quota',
      retryable: true,
      closeCode: 4029
    });
    expect(h.errors).toEqual([]);
  });

  it('provider: never carries the text of a non-ConnectorError', async () => {
    const h = await harness();
    h.connector.autoConnect = false;
    const play = h.session.play();
    await flushAsync();
    h.connector.rejectConnect(new Error('key AIza-secret rejected'));

    const error = await rejectionOf(play);
    expect(error).toMatchObject({ kind: 'provider', reason: 'internal' });
    expect(error.message).not.toContain('secret');
  });

  it('provider: one error event after Play resolved', async () => {
    const h = await playing();
    h.connector
      .latest()
      .fail(new ConnectorError({ code: 'bad-key', reason: 'auth', retryable: false }));
    await flushAsync();

    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toBeInstanceOf(GasOperationError);
    expect(h.errors[0]).toMatchObject({ kind: 'provider', reason: 'auth', retryable: false });
  });

  it('cancelled: Stop before Play resolved, with no event', async () => {
    const h = await harness();
    h.connector.autoConnect = false;
    const play = h.session.play();
    await flushAsync();
    await h.session.stop();

    expect((await rejectionOf(play)).kind).toBe('cancelled');
    expect(h.errors).toEqual([]);
  });

  it('uses only the five 0.4 kinds', async () => {
    const h = await harness({ source: null });
    const kinds = new Set<string>();
    kinds.add((await rejectionOf(h.session.loadSource('track'))).kind);
    kinds.add((await rejectionOf(h.session.play())).kind);
    await h.session.loadSource(PLAYS_AT_ONCE);
    kinds.add((await rejectionOf(h.session.setTrackLevel('track.nope', 1))).kind);

    for (const kind of kinds) {
      expect(['document', 'command', 'state', 'provider', 'cancelled']).toContain(kind);
    }
  });
});
