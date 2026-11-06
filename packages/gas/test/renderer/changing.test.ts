import { createInputState } from '../../src/core/index.js';
import { describe, expect, it } from 'vitest';
import { flushAsync } from '../../../../test/support/deferred.js';
import { testTimeline } from '../../../../test/support/timeline.js';
import { ALL_SUPPORTED, applyActive, playing, rejection } from './support/rig.js';

describe('changes while playing', () => {
  it('re-anchors live tempo without moving the current position', async () => {
    const timeline = testTimeline();
    const { clock, connection, renderer, ends } = await playing(timeline);
    connection.appliedPosition = { bar: 3 };
    clock.advanceTo(2);

    const state = applyActive(createInputState(timeline), { kind: 'setTempo', bpm: 60 });
    const result = await renderer.update(state);

    // Two bars in, the tempo halves, so the lookahead lands two of the new
    // four-second bar's beats later: beat three, not a fractional bar.
    expect(result).toEqual({
      requestedPosition: { bar: 2, beat: { index: 3 } },
      appliedPosition: { bar: 3 }
    });
    expect(connection.updates.at(-1)?.update.state.globals.tempo).toBe(60);

    // Two bars elapsed before the change. The remaining three bars now take
    // twelve seconds, so the finite end moves from t=8 to t=14.
    clock.advanceTo(8);
    await flushAsync();
    expect(ends).toEqual([]);
    clock.advanceTo(14);
    await flushAsync();
    expect(ends).toEqual([{ reason: 'finished' }]);
  });

  it('preserves app values and restarts authored boundaries at loop bar one', async () => {
    const timeline = testTimeline({ playback: { mode: 'loop', declaredBars: 4 } });
    const { clock, connector, connection, renderer, positions } = await playing(timeline);

    const state = applyActive(createInputState(timeline), {
      kind: 'setTrackFlavor',
      trackId: 'track.pad',
      value: 'persistent live warmth'
    });
    await renderer.update(state);
    clock.advanceTo(8);
    await flushAsync();

    expect(connector.connects).toHaveLength(1);
    expect(connection.calls).not.toContain('close');
    const last = positions.at(-1);
    expect({ bar: last?.position.bar, iteration: last?.loopIteration }).toEqual({
      bar: 1,
      iteration: 2
    });
    expect(connection.updates.at(-1)?.requested).toEqual({ bar: 1 });
    expect(connection.updates.at(-1)?.update.state.tracks[0]?.flavor).toEqual({
      kind: 'text',
      text: 'persistent live warmth'
    });

    renderer.stop();
  });

  it('holds after an infinite arranged pass and still accepts updates', async () => {
    const timeline = testTimeline({ playback: { mode: 'infinite' } });
    const { clock, connection, renderer, positions, ends } = await playing(timeline);

    clock.advanceTo(8);
    await flushAsync();
    expect(positions.at(-1)?.position).toEqual({ bar: 5 });
    expect(connection.updates.at(-1)?.requested).toEqual({ bar: 5 });

    const state = applyActive(createInputState(timeline), {
      kind: 'setTrackLevel',
      trackId: 'track.pad',
      value: 0.4
    });
    const result = await renderer.update(state);
    expect(result).toEqual({ requestedPosition: { bar: 5 }, appliedPosition: { bar: 5 } });
    expect(connection.updates.at(-1)?.update.state.tracks[0]?.level).toEqual({
      kind: 'level',
      value: 0.4
    });

    renderer.stop();
    expect(ends).toEqual([]);
  });

  it('converts supported Alda values and skips only a malformed slot', async () => {
    const timeline = testTimeline();
    const { connection, renderer, warnings } = await playing(timeline, {
      connector: { description: { capabilities: ALL_SUPPORTED } }
    });

    let state = applyActive(createInputState(timeline), {
      kind: 'setTrackMotif',
      trackId: 'track.pad',
      alda: 'o4 c e g'
    });
    state = applyActive(state, {
      kind: 'setTrackNotes',
      trackId: 'track.pad',
      alda: 'c/e'
    });
    await renderer.update(state);

    const notation = connection.updates.at(-1)?.update.notation;
    expect(notation).toHaveLength(1);
    expect(notation?.[0]).toMatchObject({
      trackId: 'track.pad',
      intent: 'motif',
      source: 'o4 c e g'
    });
    expect(notation?.[0]?.midi).toBeInstanceOf(Uint8Array);
    expect(warnings).toEqual([expect.objectContaining({ code: 'notation-parse-failed' })]);
  });

  it('does not convert Alda for an unsupported connector capability', async () => {
    const timeline = testTimeline();
    const { connection, renderer } = await playing(timeline);
    const state = applyActive(createInputState(timeline), {
      kind: 'setTrackMotif',
      trackId: 'track.pad',
      alda: 'o4 c e g'
    });

    await renderer.update(state);
    expect(connection.updates.at(-1)?.update.notation).toBeUndefined();
  });

  it('ends the Play with a sanitized failure when a running update fails', async () => {
    const secret = 'connector-secret-value';
    const timeline = testTimeline();
    const { connection, renderer, ends } = await playing(timeline);
    connection.update = async () => {
      throw new Error(`provider rejected ${secret}`);
    };
    const state = applyActive(createInputState(timeline), {
      kind: 'setTrackFlavor',
      trackId: 'track.pad',
      value: 'brighter'
    });

    await rejection(renderer.update(state));
    await flushAsync();
    expect(ends).toEqual([
      { reason: 'failed', failure: expect.objectContaining({ code: 'generation-failed' }) }
    ]);
    expect(JSON.stringify(ends)).not.toContain(secret);
  });

  it('rejects a failed running update with a sanitized RendererError', async () => {
    const secret = 'connector-secret-value';
    const timeline = testTimeline();
    const { connection, renderer } = await playing(timeline);
    connection.update = async () => {
      throw new Error(`provider rejected ${secret}`);
    };
    const state = applyActive(createInputState(timeline), {
      kind: 'setTrackFlavor',
      trackId: 'track.pad',
      value: 'brighter'
    });

    const caught = await rejection(renderer.update(state));
    expect(caught).toMatchObject({
      code: 'connection-failed',
      failure: { code: 'generation-failed' }
    });
    expect(String(caught)).not.toContain(secret);
  });
});
