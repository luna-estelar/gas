// Rule 1: each Play has its own connection. GAS ignores an old connection and
// closes one that arrives after Play was cancelled.
import { describe, expect, it } from 'vitest';
import { ConnectorError } from '../../../src/protocol/index.js';
import { flushAsync } from '../../../../../test/support/deferred.js';
import { harness, playing, rejectionOf } from './support/harness.js';

describe('connecting', () => {
  it('opens a new connection for each Play', async () => {
    const h = await harness();
    await h.session.play();
    await h.session.stop();
    await h.session.play();

    expect(h.connector.connects).toHaveLength(2);
    expect(h.connector.connections).toHaveLength(2);
    expect(h.connector.connections[0]).not.toBe(h.connector.connections[1]);
  });

  it('closes the connection on Stop and on Close', async () => {
    const h = await harness();
    await h.session.play();
    await h.session.stop();
    expect(h.connector.connections[0]!.calls).toContain('close');

    await h.session.play();
    await h.session.close();
    expect(h.connector.connections[1]!.calls).toContain('close');
  });

  it('ignores audio, warnings and failures from an old connection', async () => {
    const h = await playing();
    const old = h.connector.latest();
    await h.session.stop();
    await h.session.play();
    const audioBefore = h.audio.length;
    const warningsBefore = h.warnings.length;
    const statesBefore = h.states.length;

    old.pushAudio(2, 7777);
    old.warn({ code: 'old', message: 'From the old connection.' });
    old.fail(new ConnectorError({ code: 'socket-closed', reason: 'network', retryable: true }));
    await flushAsync();

    expect(h.audio.slice(audioBefore).some((chunk) => chunk.bytes.some((byte) => byte !== 0))).toBe(
      false
    );
    expect(h.warnings.slice(warningsBefore)).toEqual([]);
    expect(h.errors).toEqual([]);
    expect(h.states.length).toBe(statesBefore);
    expect(h.session.getState().status).toBe('playing');
  });

  it('closes a connection that arrives after Stop', async () => {
    const h = await harness();
    h.connector.autoConnect = false;
    h.connector.ignoreAbort = true;
    const play = h.session.play();
    await flushAsync();
    await h.session.stop();

    const late = h.connector.resolveConnect();
    expect((await rejectionOf(play)).kind).toBe('cancelled');
    await flushAsync();
    expect(late.calls).toEqual(['close']);
  });

  it('closes a connection that arrives after Close', async () => {
    const h = await harness();
    h.connector.autoConnect = false;
    h.connector.ignoreAbort = true;
    const play = h.session.play();
    await flushAsync();
    await h.session.close();

    const late = h.connector.resolveConnect();
    expect((await rejectionOf(play)).kind).toBe('cancelled');
    await flushAsync();
    expect(late.calls).toEqual(['close']);
  });

  it('aborts the connect signal on Stop and on Close', async () => {
    const h = await harness();
    h.connector.autoConnect = false;
    const first = h.session.play();
    await flushAsync();
    expect(h.connector.connects[0]!.signal.aborted).toBe(false);
    await h.session.stop();
    expect(h.connector.connects[0]!.signal.aborted).toBe(true);
    await rejectionOf(first);

    const second = h.session.play();
    await flushAsync();
    await h.session.close();
    expect(h.connector.connects[1]!.signal.aborted).toBe(true);
    await rejectionOf(second);
  });

  it('sends nothing to a connection after closing it', async () => {
    const h = await playing();
    const connection = h.connector.latest();
    await h.session.stop();
    await h.session.setTrackLevel('track.pad', 0.5);
    await h.advanceTo(30);

    expect(connection.lateCalls).toEqual([]);
  });
});
