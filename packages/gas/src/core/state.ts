// The session input state: everything the host has asked for, as frozen plain
// data. Nothing position-dependent lives here; the cascade derives that.

import type { InputState, Timeline } from '../protocol/index.js';

export type { HostTrack, InputState, Override } from '../protocol/index.js';

// Creates the initial input state for a document: the loaded timeline, no host
// tracks, and no overrides. Timeline replacement is this same call with the new
// timeline — nothing from a previous document survives except by the host
// re-issuing `defineTrack`.
export function createInputState(timeline: Timeline): InputState {
  return freezeInputState({ timeline, hostTracks: [], staged: [], live: [] });
}

// Freezes an input state and its owned arrays so callers cannot mutate a value
// Core returned. The timeline itself is the caller's value, referenced as-is and
// never mutated.
export function freezeInputState(state: InputState): InputState {
  Object.freeze(state.hostTracks);
  Object.freeze(state.staged);
  Object.freeze(state.live);
  return Object.freeze(state);
}
