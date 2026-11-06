// Rule 3: a failure during playback ends that connection only. One `error`, the
// session stopped with `ended: 'failed'`, and Play works again.
import { describe, expect, it } from 'vitest';
import { ConnectorError } from '../../../src/protocol/index.js';
import { MAX_FIRST_AUDIO_TIMEOUT_SECONDS } from '../../../src/renderer/constants.js';
import { flushAsync } from '../../../../../test/support/deferred.js';
import { harness, playing, totalSeconds } from './support/harness.js';

const dropped = () =>
  new ConnectorError({
    code: 'socket-closed',
    reason: 'network',
    retryable: true,
    closeCode: 1006
  });

describe('failing', () => {
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
    // Of the 22 s pushed, at least 10 s is still held, waiting for its time.
    expect(totalSeconds(h.audio)).toBeLessThan(12);
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

  it('waits as long as firstAudioTimeoutSeconds before failing a silent track', async () => {
    const h = await harness({ firstAudioTimeoutSeconds: 10 });
    await h.session.play();
    await h.advanceTo(9.99);
    expect(h.errors).toEqual([]);

    await h.advanceTo(10);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toMatchObject({ kind: 'provider', code: 'generation-failed' });
  });

  it('clamps firstAudioTimeoutSeconds to the maximum', async () => {
    const h = await harness({ firstAudioTimeoutSeconds: 60 });
    await h.session.play();
    await h.advanceTo(MAX_FIRST_AUDIO_TIMEOUT_SECONDS);

    expect(h.errors).toHaveLength(1);
  });

  it('wraps a non-ConnectorError failure as an internal provider error', async () => {
    const h = await playing();
    h.connector.latest().options.onError(new Error('secret provider text') as ConnectorError);
    await flushAsync();

    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toMatchObject({ kind: 'provider', reason: 'internal' });
    expect(h.errors[0]!.message).not.toContain('secret');
  });

  it('keeps a change the connection refuses, and reports the failure once', async () => {
    const h = await playing();
    h.connector.latest().updateFailure = new ConnectorError({
      code: 'bad-prompt',
      reason: 'provider',
      retryable: false
    });

    const result = await h.session.setTrackLevel('track.pad', 0.3);
    await flushAsync();

    expect(result.requestedPosition).toBeUndefined();
    expect(h.session.getState().appValues).toEqual([
      { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.3 }
    ]);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toMatchObject({ kind: 'provider', code: 'bad-prompt' });
    expect(h.session.getState()).toMatchObject({ status: 'stopped', ended: 'failed' });
  });
});
