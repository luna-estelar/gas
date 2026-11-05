import { createInputState } from '../../src/core/index.js';
import type { Timeline, TimelineEvent } from '../../src/protocol/index.js';
import { describe, expect, it } from 'vitest';
import { flushAsync } from '../../../../test/support/deferred.js';
import { testTimeline } from '../../../../test/support/timeline.js';
import { applyActive, playing, rig } from './support/rig.js';

describe('renderer scheduling and derivation', () => {
  it('anchors musical time after a delayed connect', async () => {
    const r = rig(timelineWithBarThreeStop());
    r.connector.autoConnect = false;

    const play = r.renderer.play();
    await flushAsync();
    r.clock.advanceTo(10);
    await flushAsync();
    expect(r.positions).toEqual([]);

    const connection = r.connector.resolveConnect();
    await play;
    connection.pushAudio(2);
    expect(barsAndSeconds(r.positions)).toEqual([{ bar: 1, seconds: 0 }]);

    r.clock.advanceTo(11.99);
    await flushAsync();
    expect(connection.updates).toHaveLength(0);
    r.clock.advanceTo(12);
    await flushAsync();
    expect(connection.updates[0]?.requested).toEqual({ bar: 3 });
    r.clock.advanceTo(14);
    await flushAsync();
    expect(barsAndSeconds(r.positions).at(-1)).toEqual({ bar: 3, seconds: 4 });
  });

  it('connects with bar one and derives authored boundaries ahead', async () => {
    const { clock, connector, connection } = await playing(timelineWithBarThreeStop());
    expect(connector.connects[0]?.state.tracks[0]?.active).toBe(true);

    clock.advanceTo(1.99);
    await flushAsync();
    expect(connection.updates).toHaveLength(0);

    // Bar 3 is four seconds after bar 1 at 120 BPM. One two-second chunk of
    // lookahead sends its update at t=2.
    clock.advanceTo(2);
    await flushAsync();
    expect(connection.updates).toHaveLength(1);
    expect(connection.updates[0]?.requested).toEqual({ bar: 3 });
    expect(connection.updates[0]?.update.state.tracks[0]?.active).toBe(false);
  });

  it('executes overdue same-position events immediately as one stable boundary', async () => {
    const base = timelineWithBarThreeStop();
    const timeline = {
      ...base,
      events: base.events.map((event) =>
        event.position.bar === 3 ? { ...event, position: { bar: 2 } } : event
      )
    };
    const { connection } = await playing(timeline);
    await flushAsync();

    expect(connection.updates).toHaveLength(1);
    expect(connection.updates[0]?.requested).toEqual({ bar: 2 });
    expect(connection.updates[0]?.update.state.tracks[0]).toMatchObject({
      active: false,
      flavor: { kind: 'text', text: 'distant' }
    });
  });

  it('emits position at the actual boundary rather than the lookahead deadline', async () => {
    const { clock, positions } = await playing(timelineWithBarThreeStop());
    clock.advanceTo(2);
    await flushAsync();
    expect(barsAndSeconds(positions)).toEqual([{ bar: 1, seconds: 0 }]);
    clock.advanceTo(4);
    await flushAsync();
    expect(barsAndSeconds(positions)).toEqual([
      { bar: 1, seconds: 0 },
      { bar: 3, seconds: 4 }
    ]);
  });

  it.each([
    ['4/4', { beatsPerBar: 4, beatUnit: 4 }],
    // Tempo counts the meter's own beat, so an eighth-note beat at 120 BPM is
    // half a second in 6/8 exactly as a quarter-note beat is in 4/4.
    ['6/8', { beatsPerBar: 6, beatUnit: 8 }]
  ] as const)(
    'schedules an authored beat at its own instant in %s',
    async (_meter, timeSignature) => {
      const { clock, renderer, positions } = await playing(
        timelineWithBeatThreeStop(timeSignature)
      );
      const after = positions.length;

      clock.advanceTo(0.99);
      await flushAsync();
      expect(positions.slice(after)).toEqual([]);

      clock.advanceTo(1);
      await flushAsync();
      expect(
        positions.slice(after).map(({ position, seconds }) => ({ position, seconds }))
      ).toEqual([{ position: { bar: 1, beat: { index: 3 } }, seconds: 1 }]);
      renderer.stop();
    }
  );

  it('finishes finite playback at the end boundary and clears every timer', async () => {
    const { clock, connection, ends } = await playing(timelineWithBarThreeStop());
    clock.advanceTo(7.99);
    await flushAsync();
    expect(ends).toEqual([]);

    clock.advanceTo(8);
    await flushAsync();
    expect(ends).toEqual([{ reason: 'finished' }]);
    expect(connection.calls.filter((call) => call === 'close')).toHaveLength(1);
    expect(clock.pendingDeadlines()).toEqual([]);
  });

  // An app that buffers audio is still playing the piece after the renderer is
  // done with it, so the mapping has to outlive the Play.
  it('keeps placing a finished Play until the next one or a stop', async () => {
    const { clock, connector, renderer } = await playing(timelineWithBarThreeStop());
    clock.advanceTo(8);
    await flushAsync();
    expect(renderer.positionAtSeconds(7)).toEqual({ bar: 4, beat: { index: 3 } });
    // Audio past the declared end is the last chunk's tail, not bar five.
    expect(renderer.positionAtSeconds(9)).toEqual({ bar: 5 });

    // A new Play is placed from its own anchor, not the finished one's end.
    await renderer.play();
    expect(renderer.positionAtSeconds(9)).toBeUndefined();
    connector.latest().pushAudio(2);
    expect(renderer.positionAtSeconds(9)).toEqual({ bar: 5, beat: { index: 3 } });
    renderer.stop();
    expect(renderer.positionAtSeconds(1)).toBeUndefined();
  });

  it('forgets a finished Play when playback is stopped', async () => {
    const { clock, renderer } = await playing(timelineWithBarThreeStop());
    clock.advanceTo(8);
    await flushAsync();
    renderer.stop();
    expect(renderer.positionAtSeconds(7)).toBeUndefined();
  });

  it('times finite completion from a delayed anchor', async () => {
    const r = rig(timelineWithBarThreeStop());
    r.connector.autoConnect = false;

    const play = r.renderer.play();
    await flushAsync();
    r.clock.advanceTo(10);
    const connection = r.connector.resolveConnect();
    await play;
    connection.pushAudio(2);

    r.clock.advanceTo(17.99);
    await flushAsync();
    expect(r.ends).toEqual([]);
    expect(connection.calls).not.toContain('close');
    r.clock.advanceTo(18);
    await flushAsync();
    expect(r.ends).toEqual([{ reason: 'finished' }]);
    expect(connection.calls).toContain('close');
    expect(r.clock.pendingDeadlines()).toEqual([]);
  });

  it('cancels future work on stop and rejects a second play', async () => {
    const { clock, connection, renderer } = await playing(timelineWithBarThreeStop());
    await expect(renderer.play()).rejects.toMatchObject({ code: 'wrong-state' });
    renderer.stop();
    expect(clock.pendingDeadlines()).toEqual([]);
    clock.advanceTo(20);
    await flushAsync();
    expect(connection.updates).toHaveLength(0);
    expect(connection.calls.filter((call) => call === 'close')).toHaveLength(1);
  });

  it('isolates listeners while starting playback', async () => {
    const r = rig(testTimeline());
    r.renderer.on('generationPosition', () => {
      throw new Error('app listener failure');
    });
    const bars: number[] = [];
    r.renderer.on('generationPosition', (event) => bars.push(event.position.bar));

    await expect(r.renderer.play()).resolves.toBeUndefined();
    r.connector.latest().pushAudio(2);
    expect(bars).toEqual([1]);
    r.renderer.stop();
  });

  it('closes a connection whose first update fails during startup', async () => {
    const timeline = testTimeline();
    const r = rig(timeline);
    r.connector.autoConnect = false;
    const play = r.renderer.play();
    await flushAsync();
    // A change while connecting is sent once the connection opens.
    await r.renderer.update(
      applyActive(createInputState(timeline), {
        kind: 'setTrackFlavor',
        trackId: 'track.pad',
        value: 'brighter'
      })
    );
    const connection = r.connector.resolveConnect();
    connection.update = async () => {
      throw new Error('provider startup failed');
    };

    await expect(play).rejects.toMatchObject({
      code: 'connection-failed',
      failure: { code: 'connector-unavailable' }
    });
    expect(connection.calls).toEqual(['close']);
    expect(r.ends).toEqual([]);
  });

  it('ignores a close() that rejects and plays again', async () => {
    const secret = 'provider-close-secret';
    const { connection, renderer, ends, warnings, connector } = await playing(
      testTimeline({ playback: { mode: 'infinite' } })
    );
    connection.close = async () => {
      throw new Error(`close rejected ${secret}`);
    };

    renderer.stop();
    await flushAsync();
    expect(ends).toEqual([]);
    expect(JSON.stringify(warnings)).not.toContain(secret);

    await renderer.play();
    expect(connector.connections).toHaveLength(2);
    renderer.stop();
  });

  it('produces deterministic event and connection logs for the same script', async () => {
    expect(await scriptedLog()).toEqual(await scriptedLog());
  });
});

function barsAndSeconds(
  positions: ReadonlyArray<{ position: { bar: number }; seconds: number }>
): Array<{ bar: number; seconds: number }> {
  return positions.map((event) => ({ bar: event.position.bar, seconds: event.seconds }));
}

function timelineWithBeatThreeStop(timeSignature: {
  readonly beatsPerBar: number;
  readonly beatUnit: number;
}): Timeline {
  const base = testTimeline({ playback: { mode: 'infinite' } });
  const stop: TimelineEvent = {
    eventId: 'event.stop.beat',
    type: 'track',
    targetId: 'track.pad',
    action: 'stop',
    position: { bar: 1, beat: { index: 3 } },
    sequence: 1,
    scope: 'timed',
    sectionInstanceId: 'section.main.0'
  };
  return {
    ...base,
    musicalContext: { tempo: 120, timeSignature },
    events: [...base.events, stop]
  };
}

function timelineWithBarThreeStop(): Timeline {
  const timeline = testTimeline();
  const stop: TimelineEvent = {
    eventId: 'event.stop',
    type: 'track',
    targetId: 'track.pad',
    action: 'stop',
    position: { bar: 3 },
    sequence: 1,
    scope: 'timed',
    sectionInstanceId: 'section.main.0'
  };
  const flavor: TimelineEvent = {
    eventId: 'event.flavor',
    type: 'track',
    targetId: 'track.pad',
    action: 'flavor',
    position: { bar: 3 },
    sequence: 2,
    scope: 'timed',
    sectionInstanceId: 'section.main.0',
    value: { kind: 'text', text: 'distant' }
  };
  return { ...timeline, events: [...timeline.events, stop, flavor] };
}

async function scriptedLog(): Promise<readonly string[]> {
  const { clock, connection, positions, audio, ends } = await playing(timelineWithBarThreeStop());
  clock.advanceTo(8);
  await flushAsync();
  return [
    ...connection.calls,
    ...positions.map((event) => `position:${event.position.bar}:${event.seconds}`),
    ...audio.map((chunk) => `audio:${chunk.sequence}:${chunk.durationSeconds}`),
    ...ends.map((end) => `ended:${end.reason}`)
  ];
}
