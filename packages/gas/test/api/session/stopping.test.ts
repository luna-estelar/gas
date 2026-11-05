// Rule 2: Stop and Close silence queued audio and return without waiting on the
// provider. Cleanup runs in the background with a time limit and never delays the
// next Play.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECTOR_CLEANUP_TIMEOUT_SECONDS } from '../../../src/renderer/constants.js';
import { flushAsync } from '../../../../../test/support/deferred.js';
import { playing, totalSeconds } from './support/harness.js';

// The time limit is wall time, because the audio clock stops while a browser
// context is suspended. Only the timers are faked; the virtual clock drives music.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const closeTimeouts = (warnings: readonly { code: string }[]) =>
  warnings.filter((warning) => warning.code === 'connection-close-timeout');

describe('stopping', () => {
  it('returns from Stop while close() hangs', async () => {
    const h = await playing({ connector: { closeHangs: true } });
    await h.session.stop();

    expect(h.connector.latest().calls).toContain('close');
    expect(h.session.getState()).toMatchObject({ status: 'stopped', ended: 'stopped' });
  });

  it('returns from Close while close() hangs', async () => {
    const h = await playing({ connector: { closeHangs: true } });
    await h.session.close();

    expect(h.session.getState().status).toBe('closed');
  });

  it('delivers no queued audio after Stop', async () => {
    const h = await playing();
    h.connector.latest().pushAudio(20);
    await flushAsync();
    // Of the 22 s pushed, at least 10 s is still held, waiting for its time.
    expect(totalSeconds(h.audio)).toBeLessThan(12);
    await h.session.stop();
    const delivered = h.audio.length;

    await h.advanceTo(30);
    expect(h.audio.length).toBe(delivered);
  });

  it('warns once when close() runs past the time limit', async () => {
    const h = await playing({ connector: { closeHangs: true } });
    await h.session.stop();

    await vi.advanceTimersByTimeAsync(CONNECTOR_CLEANUP_TIMEOUT_SECONDS * 1000 - 1);
    expect(closeTimeouts(h.warnings)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(closeTimeouts(h.warnings)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(CONNECTOR_CLEANUP_TIMEOUT_SECONDS * 1000);
    expect(closeTimeouts(h.warnings)).toHaveLength(1);
  });

  it('gives no warning when close() settles in time', async () => {
    const h = await playing();
    await h.session.stop();

    await vi.advanceTimersByTimeAsync(CONNECTOR_CLEANUP_TIMEOUT_SECONDS * 2000);
    expect(closeTimeouts(h.warnings)).toEqual([]);
  });

  it('connects the next Play without waiting on a hanging close()', async () => {
    const h = await playing({ connector: { closeHangs: true } });
    await h.session.stop();

    // No timer advance: the next Play must not wait for the time limit either.
    await h.session.play();
    expect(h.connector.connects).toHaveLength(2);
    expect(h.session.getState().status).toBe('playing');
  });

  it('is safe to call while stopped', async () => {
    const h = await playing();
    await h.session.stop();
    const states = h.states.length;

    await h.session.stop();
    expect(h.states.length).toBe(states);
    expect(h.connector.latest().calls.filter((call) => call === 'close')).toHaveLength(1);
  });
});
