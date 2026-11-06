import { describe, expect, it } from 'vitest';
import { createInputState, defineTrack } from '../../src/core/index.js';
import { validTimeline } from './support/timelines.js';

describe('createInputState', () => {
  it('starts with the timeline, no app tracks, and no app values', () => {
    const timeline = validTimeline();
    const state = createInputState(timeline);
    expect(state).toEqual({ timeline, appTracks: [], appValues: [] });
  });

  it('freezes the state it returns', () => {
    const state = createInputState(validTimeline());
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.appTracks)).toBe(true);
    expect(Object.isFrozen(state.appValues)).toBe(true);
  });

  it('does not mutate a frozen input timeline', () => {
    const timeline = Object.freeze(validTimeline());
    const state = createInputState(timeline);
    expect(state.timeline).toBe(timeline);
  });
});

describe('defineTrack namespace rules', () => {
  it('adds a app track that begins inactive', () => {
    const state = createInputState(validTimeline());
    const result = defineTrack(state, {
      kind: 'defineTrack',
      id: 'app.synth',
      name: 'Synth',
      description: 'live pad'
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "Inactive" is not stored: the app track carries only its identity. Whether
    // it is active at a position is derived through the cascade.
    expect(result.state.appTracks).toEqual([
      { id: 'app.synth', name: 'Synth', description: 'live pad' }
    ]);
  });

  it('keeps name and description optional', () => {
    const state = createInputState(validTimeline());
    const result = defineTrack(state, { kind: 'defineTrack', id: 'app.bare' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.appTracks).toEqual([{ id: 'app.bare' }]);
  });

  it('accumulates distinct app tracks in application order', () => {
    const state = createInputState(validTimeline());
    const first = defineTrack(state, { kind: 'defineTrack', id: 'app.a' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = defineTrack(first.state, { kind: 'defineTrack', id: 'app.b' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.appTracks.map((track) => track.id)).toEqual(['app.a', 'app.b']);
  });

  it('rejects an id already used by an authored track', () => {
    const state = createInputState(validTimeline());
    const result = defineTrack(state, { kind: 'defineTrack', id: 'track.pad' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('duplicate-track');
    expect(result.failure.trackId).toBe('track.pad');
    expect(result.failure.message.length).toBeGreaterThan(0);
  });

  it('rejects an id already used by another app track with a different definition', () => {
    const state = createInputState(validTimeline());
    const first = defineTrack(state, { kind: 'defineTrack', id: 'app.a' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const clash = defineTrack(first.state, {
      kind: 'defineTrack',
      id: 'app.a',
      description: 'other'
    });
    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.failure.code).toBe('duplicate-track');
  });

  it('returns a new frozen state and leaves the original untouched', () => {
    const state = createInputState(validTimeline());
    const result = defineTrack(state, { kind: 'defineTrack', id: 'app.a' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).not.toBe(state);
    expect(state.appTracks).toEqual([]);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.appTracks)).toBe(true);
  });

  it('rejects an empty id', () => {
    const state = createInputState(validTimeline());
    const result = defineTrack(state, { kind: 'defineTrack', id: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('invalid-value');
    expect(result.failure.message.length).toBeGreaterThan(0);
  });

  it('rejects a non-string id', () => {
    const state = createInputState(validTimeline());
    const result = defineTrack(state, { kind: 'defineTrack', id: 42 as unknown as string });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('invalid-value');
  });

  it('rejects a non-string name', () => {
    const state = createInputState(validTimeline());
    const result = defineTrack(state, {
      kind: 'defineTrack',
      id: 'app.a',
      name: 7 as unknown as string
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('invalid-value');
  });
});
