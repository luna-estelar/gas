import { createInputState } from '../../src/core/index.js';
import { ConnectorError } from '../../src/protocol/index.js';
import { describe, expect, it } from 'vitest';
import { flushAsync } from '../../../../test/support/deferred.js';
import { testTimeline } from '../../../../test/support/timeline.js';
import { applyActive, playing, rejection, rig } from './support/rig.js';

const infinite = () => testTimeline({ playback: { mode: 'infinite' } });

function brighter(timeline: ReturnType<typeof testTimeline>) {
  return applyActive(createInputState(timeline), {
    kind: 'setTrackFlavor',
    trackId: 'track.pad',
    value: 'brighter'
  });
}

describe('renderer connector failure propagation', () => {
  it.each([
    { code: 'x-prepare', reason: 'quota', retryable: false },
    { code: 'x-start', reason: 'provider', retryable: true }
  ] as const)('preserves a ConnectorError $code thrown from connect', async (expected) => {
    const r = rig(testTimeline());
    r.connector.connect = async () => {
      throw new ConnectorError(expected);
    };

    const caught = await rejection(r.renderer.play());
    expect(caught).toMatchObject({
      code: 'connector-unavailable',
      failure: { ...expected, message: 'The connector could not open a connection.' }
    });
    // Play's rejection is the only report (rule 2).
    expect(r.ends).toEqual([]);
  });

  it.each([
    ['a thrown ConnectorError', true],
    ['a connection-reported failure', false]
  ] as const)('carries a transport close code to the host through %s', async (_label, isThrown) => {
    // The renderer classifies nothing about a close code; a host maps the
    // application range itself, so the raw number has to survive the trip.
    const timeline = infinite();
    const { connection, renderer, ends } = await playing(timeline);
    const error = new ConnectorError({
      code: 'x-closed',
      reason: 'network',
      retryable: true,
      closeCode: 4429
    });

    if (isThrown) {
      connection.update = async () => {
        throw error;
      };
      await rejection(renderer.update(brighter(timeline)));
    } else {
      connection.fail(error);
    }
    await flushAsync();
    expect(ends).toEqual([
      {
        reason: 'failed',
        failure: expect.objectContaining({ code: 'x-closed', closeCode: 4429 })
      }
    ]);
  });

  it('drops a close code the transport could not have produced', async () => {
    const { connection, ends } = await playing(infinite());
    const error = new ConnectorError({ code: 'x-closed', reason: 'network', retryable: true });
    Object.defineProperty(error, 'closeCode', { value: 99_999 });

    connection.fail(error);
    await flushAsync();
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ reason: 'failed' });
    expect((ends[0] as { failure: object }).failure).not.toHaveProperty('closeCode');
  });

  it('preserves a ConnectorError thrown from a running state update', async () => {
    const timeline = testTimeline();
    const { connection, renderer, ends } = await playing(timeline);
    connection.update = async () => {
      throw new ConnectorError({ code: 'x-update', reason: 'provider', retryable: true });
    };

    await rejection(renderer.update(brighter(timeline)));
    await flushAsync();
    expect(ends).toEqual([
      {
        reason: 'failed',
        failure: {
          code: 'x-update',
          reason: 'provider',
          retryable: true,
          message: 'Audio generation failed during playback.'
        }
      }
    ]);
  });

  it('preserves a ConnectorError thrown from a scheduled boundary update', async () => {
    const { clock, connection, ends } = await playing(
      testTimeline({ playback: { mode: 'loop', declaredBars: 4 } })
    );
    connection.update = async () => {
      throw new ConnectorError({ code: 'x-scheduled', reason: 'network', retryable: true });
    };
    clock.advanceTo(8);
    await flushAsync();

    expect(ends).toEqual([
      {
        reason: 'failed',
        failure: {
          code: 'x-scheduled',
          reason: 'network',
          retryable: true,
          message: 'Audio generation failed during playback.'
        }
      }
    ]);
  });

  it('keeps unknown thrown values generic and never leaks their contents', async () => {
    const secret = 'do-not-leak-unknown-failure';
    const cases: unknown[] = [
      new Error(`provider rejected ${secret}`),
      `raw string with ${secret}`,
      { code: 'x-object', reason: 'auth', retryable: false, message: secret },
      renamedLookalike(secret)
    ];

    for (const failure of cases) {
      const r = rig(testTimeline());
      r.connector.connect = async () => {
        throw failure;
      };
      const caught = await rejection(r.renderer.play());
      expect(caught).toMatchObject({
        code: 'connector-unavailable',
        failure: {
          code: 'connector-unavailable',
          reason: 'internal',
          retryable: true,
          message: 'The connector could not open a connection.'
        }
      });
      expect(JSON.stringify(caught)).not.toContain(secret);
    }
  });
});

function renamedLookalike(secret: string): Error {
  const error = new Error(secret);
  error.name = 'ConnectorError';
  // Wrong field types: the structural guard must reject this, keeping it generic.
  Object.assign(error, { code: 42, reason: 'not-a-reason', retryable: 'yes' });
  return error;
}
