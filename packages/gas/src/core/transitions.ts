// Lifecycle transitions. Stop and retry are invoked by the API, completion and
// loop boundaries by the Renderer. None can fail, and none touch `hostTracks` or
// `timeline`. Replacing the timeline is `createInputState(newTimeline)`.

import type { InputState } from './state.js';
import { freezeInputState } from './state.js';

// Stop clears all staged and live overrides, so the authored document alone
// determines effective state again. Host tracks and the timeline stay.
export function applyStop(state: InputState): InputState {
  return clearOverrides(state);
}

export function applyCompletion(state: InputState): InputState {
  return clearOverrides(state);
}

export function applyRetry(state: InputState): InputState {
  return clearOverrides(state);
}

// Keeps the overrides; callers must not depend on object identity.
export function applyLoopBoundary(state: InputState): InputState {
  return state;
}

function clearOverrides(state: InputState): InputState {
  return freezeInputState({ ...state, staged: [], live: [] });
}
