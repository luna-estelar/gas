import { describe, expect, it } from 'vitest';
import { createInputState, defineTrack } from '../src/index.js';
import { validTimeline } from './support/timelines.js';

describe('createInputState', () => {
  it('starts with the timeline, no host tracks, and no overrides', () => {
    const timeline = validTimeline();
    const state = createInputState(timeline);
    expect(state.timeline).toBe(timeline);
    expect(state.hostTracks).toEqual([]);
    expect(state.staged).toEqual([]);
    expect(state.live).toEqual([]);
  });

  it('freezes the state it returns', () => {
    const state = createInputState(validTimeline());
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.hostTracks)).toBe(true);
    expect(Object.isFrozen(state.staged)).toBe(true);
    expect(Object.isFrozen(state.live)).toBe(true);
  });

  it('does not mutate a frozen input timeline', () => {
    const timeline = Object.freeze(validTimeline());
    const state = createInputState(timeline);
    expect(state.timeline).toBe(timeline);
  });
});

describe('defineTrack namespace rules', () => {
  it('adds a host track that begins inactive', () => {
    const state = createInputState(validTimeline());
    const result = defineTrack(state, {
      kind: 'defineTrack',
      id: 'host.synth',
      name: 'Synth',
      description: 'live pad'
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "Inactive" is not stored: the host track carries only its identity. Whether
    // it is active at a position is derived through the cascade.
    expect(result.state.hostTracks).toEqual([
      { id: 'host.synth', name: 'Synth', description: 'live pad' }
    ]);
  });

  it('keeps name and description optional', () => {
    const state = createInputState(validTimeline());
    const result = defineTrack(state, { kind: 'defineTrack', id: 'host.bare' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.hostTracks).toEqual([{ id: 'host.bare' }]);
  });

  it('accumulates distinct host tracks in application order', () => {
    const state = createInputState(validTimeline());
    const first = defineTrack(state, { kind: 'defineTrack', id: 'host.a' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = defineTrack(first.state, { kind: 'defineTrack', id: 'host.b' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.hostTracks.map((track) => track.id)).toEqual(['host.a', 'host.b']);
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

  it('rejects an id already used by another host track', () => {
    const state = createInputState(validTimeline());
    const first = defineTrack(state, { kind: 'defineTrack', id: 'host.a' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const clash = defineTrack(first.state, { kind: 'defineTrack', id: 'host.a' });
    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.failure.code).toBe('duplicate-track');
  });

  it('returns a new frozen state and leaves the original untouched', () => {
    const state = createInputState(validTimeline());
    const result = defineTrack(state, { kind: 'defineTrack', id: 'host.a' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).not.toBe(state);
    expect(state.hostTracks).toEqual([]);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.hostTracks)).toBe(true);
  });
});
