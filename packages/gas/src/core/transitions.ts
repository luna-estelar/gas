// Loading a new document. Stop, completion, a failure and a loop leave the input
// state alone, because app values last until the app clears them.

import type {
  AppValueDroppedWarning,
  Command,
  CommandFailure,
  CommandWarning,
  Timeline
} from '../protocol/index.js';
import { applyCommands, trackIdOf, type ApplyCommandOptions } from './commands.js';
import type { InputState } from './state.js';
import { createInputState, freezeInputState } from './state.js';

// What loading a new document does with app values. `'keep'` carries them over,
// `'clear'` starts empty, and a command list starts empty then applies the list.
export type AppValuesMode = 'keep' | 'clear' | readonly Command[];

export type NewTimelineResult =
  | {
      readonly ok: true;
      readonly state: InputState;
      readonly warnings: readonly (CommandWarning | AppValueDroppedWarning)[];
    }
  | { readonly ok: false; readonly failure: CommandFailure; readonly index?: number };

export function applyNewTimeline(
  state: InputState,
  timeline: Timeline,
  mode: AppValuesMode,
  options: ApplyCommandOptions
): NewTimelineResult {
  if (mode === 'clear') {
    return { ok: true, state: createInputState(timeline), warnings: [] };
  }
  if (Array.isArray(mode)) {
    return applyCommands(createInputState(timeline), mode as readonly Command[], options);
  }
  if (mode !== 'keep') {
    return {
      ok: false,
      failure: {
        code: 'invalid-value',
        message: 'appValues must be "keep", "clear" or a list of commands.'
      }
    };
  }
  return keepAppValues(state, timeline);
}

// App tracks last until the app removes them, so a new document that declares an
// app track's id fails the load rather than silently replacing the track. A value
// whose track is gone is dropped with a warning.
function keepAppValues(state: InputState, timeline: Timeline): NewTimelineResult {
  const documentIds = new Set(timeline.tracks.map((track) => track.trackId));
  const collision = state.appTracks.find((track) => documentIds.has(track.id));
  if (collision !== undefined) {
    return {
      ok: false,
      failure: {
        code: 'duplicate-track',
        trackId: collision.id,
        message: `The new document declares "${collision.id}", which is already an app track. Remove that track first, or load with appValues 'clear' or a command list.`
      }
    };
  }
  const appTracks = state.appTracks;
  const known = new Set([...documentIds, ...appTracks.map((track) => track.id)]);
  const appValues: InputState['appValues'][number][] = [];
  const warnings: AppValueDroppedWarning[] = [];
  for (const value of state.appValues) {
    const trackId = trackIdOf(value);
    if (trackId === undefined || known.has(trackId)) {
      appValues.push(value);
      continue;
    }
    warnings.push({
      code: 'app-value-dropped',
      trackId,
      command: value,
      message: `The new document has no track "${trackId}", so its ${value.kind} value was dropped.`
    });
  }
  return { ok: true, state: freezeInputState({ timeline, appTracks, appValues }), warnings };
}
