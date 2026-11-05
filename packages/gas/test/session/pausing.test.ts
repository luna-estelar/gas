// Rule 6: GAS pauses the model for a rest and for a backlog, and resumes it only
// when neither applies. Pausing is one state, so one `pause()` covers both.
// Skipped until GAS 0.4 step 4 implements the session these describe.
import { describe, expect, it } from 'vitest';
import {
  BUFFER_HARD_LIMIT_SECONDS,
  BUFFER_WARNING_SECONDS,
  RESUME_LEAD_SECONDS
} from '../../src/renderer/constants.js';
import { flushAsync } from '../../../../test/support/deferred.js';
import { MIDDLE_REST, barTime, harness } from './support/harness.js';

/** A rest from bar 3 to bar 30, longer than any backlog takes to drain. */
const LONG_REST = MIDDLE_REST.replace(/14/g, '34').replace('bar 11:', 'bar 31:');

describe.skip('pausing', () => {
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
    connection.pushAudio(BUFFER_HARD_LIMIT_SECONDS - 2);
    await flushAsync();
    expect(connection.flow).toEqual([]);

    connection.pushAudio(4);
    await flushAsync();
    expect(connection.flow).toEqual(['pause']);

    // Delivery drains the backlog as the clock moves. Below the warning level, it resumes.
    const drained = BUFFER_HARD_LIMIT_SECONDS + 2 - BUFFER_WARNING_SECONDS;
    await h.advanceTo(drained - 2);
    expect(connection.flow).toEqual(['pause']);
    await h.advanceTo(drained + 2);
    expect(connection.flow).toEqual(['pause', 'resume']);
  });

  it('keeps the model paused through a rest after a backlog drains', async () => {
    const h = await harness({ source: LONG_REST });
    await h.session.play();
    const connection = h.connector.latest();
    connection.pushAudio(BUFFER_HARD_LIMIT_SECONDS + 2);
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

    // Generation runs far ahead of the track that's about to start.
    connection.pushAudio(BUFFER_HARD_LIMIT_SECONDS + 2);
    await flushAsync();
    expect(connection.flow).toEqual(['pause', 'resume', 'pause']);
    await h.advanceTo(barTime(11) + 4);
    expect(connection.flow).toEqual(['pause', 'resume', 'pause']);
  });
});
