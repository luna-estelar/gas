// The lifecycle transitions: pure `InputState -> InputState` functions for stop,
// completion, retry, and loop boundaries. Core defines them; the GAS API and
// Renderer decide when to invoke them (stop and retry are API transitions,
// completion and loop boundaries are Renderer facts). No transition can fail —
// each takes any valid input state and returns a frozen one. None touch
// `hostTracks` or `timeline`; they only empty (or preserve) the override arrays.
// Timeline replacement is not here — it is `createInputState(newTimeline)`.

import type { InputState } from './state.js';
import { freezeInputState } from './state.js';

// Stop clears all staged and live overrides, so the authored document alone
// determines effective state again. Host tracks and the timeline stay.
export function applyStop(state: InputState): InputState {
  return clearOverrides(state);
}

// Completion clears staged and live overrides.
export function applyCompletion(state: InputState): InputState {
  return clearOverrides(state);
}

// Retry preserves host tracks and clears staged and live overrides.
export function applyRetry(state: InputState): InputState {
  return clearOverrides(state);
}

// Preserve staged and live overrides at loop boundaries. Authored events are
// derived again for the new position. Callers must not depend on object identity.
export function applyLoopBoundary(state: InputState): InputState {
  return state;
}

function clearOverrides(state: InputState): InputState {
  return freezeInputState({ ...state, staged: [], live: [] });
}
