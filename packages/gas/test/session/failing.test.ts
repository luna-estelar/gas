// Rule 3: a failure during playback ends that connection only. One `error`, the
// session stopped with `ended: 'failed'`, and Play works again.
// Skipped until GAS 0.4 step 4 implements the session these describe.
import { describe, expect, it } from 'vitest';
import { ConnectorError } from '../../src/protocol/index.js';
import { MAX_FIRST_AUDIO_TIMEOUT_SECONDS } from '../../src/renderer/constants.js';
import { flushAsync } from '../../../../test/support/deferred.js';
import { harness, playing } from './support/harness.js';

const dropped = () =>
  new ConnectorError({
    code: 'socket-closed',
    reason: 'network',
    retryable: true,
    closeCode: 1006
  });

describe.skip('failing', () => {
  it('emits one error and stops', async () => {
    const h = await playing();
    h.connector.latest().fail(dropped());
    await flushAsync();

    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toMatchObject({
      kind: 'provider',
      code: 'socket-closed',
      reason: 'network',
      retryable: true,
      closeCode: 1006
    });
    expect(h.session.getState()).toMatchObject({ status: 'stopped', ended: 'failed' });
  });

  it('closes the failed connection', async () => {
    const h = await playing();
    h.connector.latest().fail(dropped());
    await flushAsync();

    expect(h.connector.latest().calls).toContain('close');
  });

  it('reports a connection that fails twice once', async () => {
    const h = await playing();
    const connection = h.connector.latest();
    connection.fail(dropped());
    connection.fail(new ConnectorError({ code: 'again', reason: 'provider', retryable: false }));
    await flushAsync();

    expect(h.errors).toHaveLength(1);
  });

  it('plays again on the same session', async () => {
    const h = await playing();
    h.connector.latest().fail(dropped());
    await flushAsync();

    await h.session.play();
    expect(h.connector.connects).toHaveLength(2);
    expect(h.session.getState().status).toBe('playing');
  });

  it('delivers no queued audio after a failure', async () => {
    const h = await playing();
    h.connector.latest().pushAudio(20);
    await flushAsync();
    h.connector.latest().fail(dropped());
    await flushAsync();
    const delivered = h.audio.length;

    await h.advanceTo(30);
    expect(h.audio.length).toBe(delivered);
  });

  it('fails the same way when a playing track gets no audio', async () => {
    const h = await harness();
    await h.session.play();
    await h.advanceTo(MAX_FIRST_AUDIO_TIMEOUT_SECONDS + 1);

    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]!.kind).toBe('provider');
    expect(h.session.getState()).toMatchObject({ status: 'stopped', ended: 'failed' });
  });

  it('wraps a non-ConnectorError failure as an internal provider error', async () => {
    const h = await playing();
    h.connector.latest().options.onError(new Error('secret provider text') as ConnectorError);
    await flushAsync();

    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toMatchObject({ kind: 'provider', reason: 'internal' });
    expect(h.errors[0]!.message).not.toContain('secret');
  });
});
