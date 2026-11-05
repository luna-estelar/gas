// Musical time starts with the first audio when a track plays at bar 1, not
// when the connection opens. A connection that opens at session setup would
// otherwise start the musical clock before any audio exists, leaving every chunk
// that much closer to being late.
import { createInputState } from '../../src/core/index.js';
import { describe, expect, it } from 'vitest';
import { flushAsync } from '../../../../test/support/deferred.js';
import { testTimeline } from '../../../../test/support/timeline.js';
import { applyActive, playing, rig } from './support/rig.js';

const infinite = () => testTimeline({ playback: { mode: 'infinite' } });

describe('renderer anchoring', () => {
  it('anchors bar one to the arrival of the first chunk', async () => {
    const { clock, connection, renderer, positions, audio } = await playing(infinite(), {
      firstAudio: 0
    });

    // play() has resolved, but nothing is audible yet, so nothing has started.
    expect(positions).toEqual([]);

    clock.advanceTo(1.3);
    connection.pushAudio(2);

    // Bar one is now, so the Play is zero seconds old however long startup took.
    expect(positions).toEqual([{ position: { bar: 1 }, seconds: 0, loopIteration: 1 }]);
    expect(audio.map((value) => value.sequence)).toEqual([0]);
    expect(renderer.positionAtSeconds(0)).toEqual({ bar: 1 });
    // Two seconds per bar at 120 BPM 4/4.
    expect(renderer.positionAtSeconds(2)).toEqual({ bar: 2 });
    expect(renderer.positionAtSeconds(1)).toEqual({ bar: 1, beat: { index: 3 } });
  });

  it('paces the chunks after the first from the anchor, not from startup', async () => {
    const { clock, connection, audio } = await playing(infinite(), { firstAudio: 0 });
    clock.advanceTo(1.3);
    connection.pushAudio(6);

    // Chunk zero starts at the anchor; chunk one is due at 3.3 and released a
    // lookahead of one chunk ahead of that, so immediately. Chunk two waits.
    expect(audio.map((value) => value.sequence)).toEqual([0, 1]);
    clock.advanceTo(3.29);
    expect(audio).toHaveLength(2);
    clock.advanceTo(3.3);
    expect(audio.map((value) => value.sequence)).toEqual([0, 1, 2]);
  });

  it('anchors once the connection opens, for audio sent while connecting', async () => {
    // A provider may send audio before connect() resolves. Anchoring at that
    // arrival would credit musical time nobody heard, since nothing is delivered
    // before the anchor exists.
    const r = rig(infinite());
    r.connector.autoConnect = false;
    const play = r.renderer.play();
    await flushAsync();
    r.clock.advanceTo(0.4);
    const connection = r.connector.resolveConnect();
    connection.pushAudio(2);
    expect(r.audio).toEqual([]);

    r.clock.advanceTo(0.9);
    await play;

    expect(r.positions).toHaveLength(1);
    expect(r.positions[0]).toMatchObject({ position: { bar: 1 }, seconds: 0 });
    expect(r.audio).toHaveLength(1);
    expect(r.renderer.positionAtSeconds(0)).toEqual({ bar: 1 });
  });

  it('fails the Play when an open connection stays silent', async () => {
    const { clock, renderer, ends } = await playing(infinite(), {
      firstAudio: 0,
      renderer: { firstAudioTimeoutSeconds: 4 }
    });

    clock.advanceTo(3.99);
    await flushAsync();
    expect(ends).toEqual([]);

    clock.advanceTo(4);
    await flushAsync();
    expect(ends).toEqual([
      {
        reason: 'failed',
        failure: {
          code: 'generation-failed',
          message: 'The connector produced no audio for a playing track before the timeout.',
          reason: 'provider',
          retryable: true
        }
      }
    ]);
    expect(clock.pendingDeadlines()).toEqual([]);
    expect(renderer.positionAtSeconds(0)).toBeUndefined();
  });

  it('defaults the silence timeout to three chunk durations, clamped', async () => {
    // The fake connector advertises two-second chunks, so the default is six.
    const { clock, ends } = await playing(infinite(), { firstAudio: 0 });
    clock.advanceTo(5.99);
    await flushAsync();
    expect(ends).toEqual([]);
    clock.advanceTo(6);
    await flushAsync();
    expect(ends).toHaveLength(1);
  });

  it('cancels the silence timeout once audio arrives', async () => {
    const { clock, connection, ends } = await playing(infinite(), {
      firstAudio: 0,
      renderer: { firstAudioTimeoutSeconds: 4 }
    });
    clock.advanceTo(1);
    connection.pushAudio(2);
    clock.advanceTo(20);
    await flushAsync();
    expect(ends).toEqual([]);
  });

  it('accepts a state change made before the first chunk arrives', async () => {
    // play() resolves before audio exists, so a host that reaches for a fader in
    // that moment must be answered rather than told the renderer is busy.
    const timeline = infinite();
    const { clock, connection, renderer, positions } = await playing(timeline, { firstAudio: 0 });

    const state = applyActive(createInputState(timeline), { kind: 'setTempo', bpm: 60 });
    const result = await renderer.update(state);
    expect(result).toEqual({ requestedPosition: { bar: 1 }, appliedPosition: { bar: 1 } });
    expect(connection.updates.at(-1)?.update.state.globals.tempo).toBe(60);

    // The tempo set before the anchor is the tempo the anchored Play keeps:
    // four seconds a bar, so bar two is four seconds after first audio.
    clock.advanceTo(1);
    connection.pushAudio(2);
    expect(positions).toHaveLength(1);
    expect(renderer.positionAtSeconds(4)).toEqual({ bar: 2 });
  });

  it('keeps no playhead before the anchor or after the Play', async () => {
    const { connection, renderer } = await playing(infinite(), { firstAudio: 0 });
    expect(renderer.positionAtSeconds(1)).toBeUndefined();

    connection.pushAudio(2);
    expect(renderer.positionAtSeconds(1)).toEqual({ bar: 1, beat: { index: 3 } });
    expect(renderer.positionAtSeconds(Number.NaN)).toBeUndefined();

    renderer.stop();
    expect(renderer.positionAtSeconds(1)).toBeUndefined();
  });

  it('drops audio a finished connection sends, without a warning (rule 1)', async () => {
    const { clock, connection, audio, warnings, ends } = await playing(testTimeline());
    clock.advanceTo(8);
    await flushAsync();
    expect(ends).toEqual([{ reason: 'finished' }]);

    connection.pushAudio(2);
    await flushAsync();
    // Only the chunk that anchored the Play was ever delivered.
    expect(audio).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('still finishes when the connection rejects the close at the end', async () => {
    // GAS closes in the background and never waits on it (rule 2), so a close
    // that fails can't turn a finished piece into a failed one.
    const { clock, connection, ends } = await playing(testTimeline());
    connection.close = async () => {
      throw new Error('provider refused the close');
    };

    clock.advanceTo(8);
    await flushAsync();

    expect(ends).toEqual([{ reason: 'finished' }]);
  });

  it('reverts to the document tempo when a pre-anchor override is cleared', async () => {
    // Clearing an override means "no override", not "keep the last value". The
    // document declares no tempo here, so the renderer default is what is left.
    const timeline = testTimeline({ playback: { mode: 'infinite' }, musicalContext: undefined });
    const { clock, connection, renderer } = await playing(timeline, { firstAudio: 0 });

    const slow = applyActive(createInputState(timeline), { kind: 'setTempo', bpm: 60 });
    await renderer.update(slow);
    await renderer.update(applyActive(slow, { kind: 'clearTempo' }));

    clock.advanceTo(1);
    connection.pushAudio(2);
    // The default is 120 BPM 4/4, so a bar is two seconds, not four.
    expect(renderer.positionAtSeconds(2)).toEqual({ bar: 2 });
  });

  it('places no playhead in an iteration the live tempo map no longer describes', async () => {
    // A loop boundary rebuilds the map from bar one at that instant. A host whose
    // audio lags asks about the iteration before it, which the map cannot place,
    // and reporting bar one would walk a buffered playhead backwards.
    const { clock, renderer } = await playing(
      testTimeline({ playback: { mode: 'loop', declaredBars: 4 } })
    );

    expect(renderer.positionAtSeconds(7.5)).toEqual({ bar: 4, beat: { index: 4 } });
    expect(renderer.positionAtSeconds(-1)).toBeUndefined();

    clock.advanceTo(8);
    await flushAsync();

    expect(renderer.positionAtSeconds(7.5)).toBeUndefined();
    expect(renderer.positionAtSeconds(8)).toEqual({ bar: 1 });
    expect(renderer.positionAtSeconds(10)).toEqual({ bar: 2 });
    renderer.stop();
  });
});
