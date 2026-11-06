// The session input state: everything the app has asked for, as frozen plain
// data. Nothing position-dependent lives here; the cascade derives that.

import type { InputState, Timeline } from '../protocol/index.js';

export type { AppTrack, InputState, AppValue } from '../protocol/index.js';

// Creates the input state for a document: the timeline, no app tracks and no
// app values. `applyNewTimeline` decides what carries over from an old document.
export function createInputState(timeline: Timeline): InputState {
  return freezeInputState({ timeline, appTracks: [], appValues: [] });
}

// Freezes an input state and its owned arrays so callers cannot mutate a value
// Core returned. The timeline itself is the caller's value, referenced as-is and
// never mutated.
export function freezeInputState(state: InputState): InputState {
  Object.freeze(state.appTracks);
  Object.freeze(state.appValues);
  return Object.freeze(state);
}
