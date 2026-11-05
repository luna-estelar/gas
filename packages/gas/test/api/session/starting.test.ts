// Rule 2: Play resolves once the connection is open and rejects once if startup
// fails. Stop or Close before that rejects it with `cancelled`, even while the
// provider hangs.
import { describe, expect, it } from 'vitest';
import { ConnectorError } from '../../../src/protocol/index.js';
import { flushAsync } from '../../../../../test/support/deferred.js';
import { harness, rejectionOf } from './support/harness.js';

async function connecting() {
  const h = await harness();
  h.connector.autoConnect = false;
  let settled = false;
  const play = h.session.play();
  void play.then(
    () => (settled = true),
    () => (settled = true)
  );
  await flushAsync();
  return { ...h, play, settled: () => settled };
}

describe('starting', () => {
  it('resolves Play once the connection opens', async () => {
    const h = await connecting();
    expect(h.settled()).toBe(false);
    expect(h.session.getState().status).toBe('starting');

    h.connector.resolveConnect();
    await h.play;
    expect(h.session.getState().status).toBe('playing');
  });

  it('rejects Play once when startup fails, with no error event', async () => {
    const h = await connecting();
    h.connector.rejectConnect(
      new ConnectorError({ code: 'bad-key', reason: 'auth', retryable: false, closeCode: 4001 })
    );

    const error = await rejectionOf(h.play);
    expect(error).toMatchObject({
      kind: 'provider',
      reason: 'auth',
      retryable: false,
      closeCode: 4001
    });
    expect(h.errors).toEqual([]);
    expect(h.session.getState().status).toBe('stopped');
  });

  it('plays again after a startup failure', async () => {
    const h = await connecting();
    h.connector.rejectConnect(
      new ConnectorError({ code: 'offline', reason: 'network', retryable: true })
    );
    await rejectionOf(h.play);

    h.connector.autoConnect = true;
    await h.session.play();
    expect(h.session.getState().status).toBe('playing');
  });

  it('rejects Play with cancelled when Stop comes first', async () => {
    const h = await connecting();
    await h.session.stop();

    expect((await rejectionOf(h.play)).kind).toBe('cancelled');
    expect(h.errors).toEqual([]);
    expect(h.session.getState().status).toBe('stopped');
  });

  it('rejects Play with cancelled when Close comes first', async () => {
    const h = await connecting();
    await h.session.close();

    expect((await rejectionOf(h.play)).kind).toBe('cancelled');
    expect(h.errors).toEqual([]);
    expect(h.session.getState().status).toBe('closed');
  });

  it('cancels at once while connect() hangs and ignores the signal', async () => {
    const h = await harness();
    h.connector.autoConnect = false;
    h.connector.ignoreAbort = true;
    const play = h.session.play();
    await flushAsync();

    // connect() never settles, yet Stop returns and Play rejects.
    await h.session.stop();
    expect((await rejectionOf(play)).kind).toBe('cancelled');
    expect(h.connector.connectPending).toBe(true);
  });

  it('plays again after a cancelled start', async () => {
    const h = await connecting();
    await h.session.stop();
    await rejectionOf(h.play);

    h.connector.autoConnect = true;
    await h.session.play();
    expect(h.session.getState().status).toBe('playing');
    expect(h.connector.connects).toHaveLength(2);
  });

  it('rejects with cancelled, not provider, when startup fails after Stop', async () => {
    const h = await harness();
    h.connector.autoConnect = false;
    h.connector.ignoreAbort = true;
    const play = h.session.play();
    await flushAsync();
    await h.session.stop();
    h.connector.rejectConnect(
      new ConnectorError({ code: 'offline', reason: 'network', retryable: true })
    );

    expect((await rejectionOf(play)).kind).toBe('cancelled');
    await flushAsync();
    expect(h.errors).toEqual([]);
  });
});
