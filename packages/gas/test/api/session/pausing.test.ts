// Rule 6: GAS pauses the model for a rest and for a backlog, and resumes it only
// when neither applies. Pausing is one state, so one `pause()` covers both.
import { describe, expect, it } from 'vitest';
import {
  BUFFER_HARD_LIMIT_SECONDS,
  BUFFER_WARNING_SECONDS
} from '../../../src/renderer/constants.js';
import { flushAsync } from '../../../../../test/support/deferred.js';
import { fakeDescription } from '../../../../../test/support/fake-connection.js';
import { MIDDLE_REST, RESUME_LEAD_SECONDS, barTime, harness } from './support/harness.js';

// The fake sends audio in chunks of this length. A chunk is released one chunk
// before it is due, so right after bar 1 the first two go out at once and the
// rest is held: held = pushed - 2 * CHUNK.
const CHUNK = fakeDescription().model.chunkDurationSeconds;
const HARD = BUFFER_HARD_LIMIT_SECONDS;
const WARNING = BUFFER_WARNING_SECONDS;

/** A rest from bar 3 to bar 30, longer than any backlog takes to drain. */
const LONG_REST = MIDDLE_REST.replace(/14/g, '34').replace('bar 11:', 'bar 31:');

describe('pausing', () => {
  it('pauses for a rest', async () => {
    const h = await harness({ source: MIDDLE_REST });
    await h.session.play();
    const connection = h.connector.latest();
    connection.pushAudio(barTime(3));
    await h.advanceTo(barTime(2));
    expect(connection.flow).toEqual([]);

    await h.advanceTo(barTime(3));
    expect(connection.flow).toEqual(['pause']);
  });

  it('pauses for a backlog and resumes once it drains', async () => {
    const h = await harness();
    await h.session.play();
    const connection = h.connector.latest();
    // HARD + CHUNK pushed holds HARD - CHUNK: not yet a backlog.
    connection.pushAudio(HARD + CHUNK);
    await flushAsync();
    expect(connection.flow).toEqual([]);

    // Two chunks more hold HARD + CHUNK.
    connection.pushAudio(2 * CHUNK);
    await flushAsync();
    expect(connection.flow).toEqual(['pause']);

    // At time t, audio due before t + 2 * CHUNK has gone out, so held drops
    // below WARNING once t passes `drain`.
    const total = HARD + 3 * CHUNK;
    const drain = total - WARNING - 2 * CHUNK;
    await h.advanceTo(drain - CHUNK);
    expect(connection.flow).toEqual(['pause']);
    await h.advanceTo(drain + CHUNK);
    expect(connection.flow).toEqual(['pause', 'resume']);
  });

  it('keeps the model paused through a rest after a backlog drains', async () => {
    const h = await harness({ source: LONG_REST });
    await h.session.play();
    const connection = h.connector.latest();
    // Holds HARD + CHUNK: a backlog.
    connection.pushAudio(HARD + 3 * CHUNK);
    await flushAsync();
    expect(connection.flow).toEqual(['pause']);

    // The backlog is gone well before the rest ends, and the rest still holds.
    await h.advanceTo(barTime(31) - RESUME_LEAD_SECONDS - 0.01);
    expect(connection.flow).toEqual(['pause']);

    await h.advanceTo(barTime(31) - RESUME_LEAD_SECONDS);
    expect(connection.flow).toEqual(['pause', 'resume']);
  });

  it('keeps the model paused at the end of a rest while a backlog holds', async () => {
    const h = await harness({ source: MIDDLE_REST });
    await h.session.play();
    const connection = h.connector.latest();
    connection.pushAudio(barTime(3));
    await h.advanceTo(barTime(11) - RESUME_LEAD_SECONDS);
    expect(connection.flow).toEqual(['pause', 'resume']);

    // Generation runs far ahead of the track that's about to start. The audio
    // is placed from the entry, and within one chunk of it only the first chunk
    // goes out at once, so HARD + CHUNK is held.
    connection.pushAudio(HARD + 2 * CHUNK);
    await flushAsync();
    expect(connection.flow).toEqual(['pause', 'resume', 'pause']);
    // At the entry plus two chunks, HARD - 2 * CHUNK is still held, above WARNING.
    await h.advanceTo(barTime(11) + 2 * CHUNK);
    expect(connection.flow).toEqual(['pause', 'resume', 'pause']);
  });
});
