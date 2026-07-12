// Host track declarations and command validation types.

import type { InputState, HostTrack } from './state.js';
import { freezeInputState } from './state.js';

// Define a host track. Phase-independent: host tracks are not overrides, so this
// applies the same whether the session is stopped or active.
export interface DefineTrackCommand {
  readonly kind: 'defineTrack';
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

// Structured command failures with stable codes.
export type CommandFailureCode =
  | 'duplicate-track'
  | 'unknown-track'
  | 'invalid-level'
  | 'invalid-tempo';

export interface CommandFailure {
  readonly code: CommandFailureCode;
  readonly message: string;
  readonly trackId?: string;
}

export type DefineTrackResult =
  | { readonly ok: true; readonly state: InputState }
  | { readonly ok: false; readonly failure: CommandFailure };

// Applies a `defineTrack` command. The host-supplied `id` shares the authored
// track namespace, so it must be unique across the timeline's declared tracks
// and any already-defined host tracks; a collision fails the command and leaves
// the state untouched. On success the track joins `hostTracks` and begins
// inactive — activity is derived through the cascade, never stored here.
export function defineTrack(state: InputState, command: DefineTrackCommand): DefineTrackResult {
  const { id } = command;
  if (trackIdExists(state, id)) {
    return {
      ok: false,
      failure: {
        code: 'duplicate-track',
        trackId: id,
        message: `A track with id "${id}" already exists; each track needs a unique id.`
      }
    };
  }

  const hostTrack: HostTrack = {
    id,
    ...(command.name !== undefined ? { name: command.name } : {}),
    ...(command.description !== undefined ? { description: command.description } : {})
  };
  return {
    ok: true,
    state: freezeInputState({ ...state, hostTracks: [...state.hostTracks, hostTrack] })
  };
}

// Whether `id` is already taken in the shared authored + host track namespace.
function trackIdExists(state: InputState, id: string): boolean {
  return (
    state.timeline.tracks.some((track) => track.trackId === id) ||
    state.hostTracks.some((track) => track.id === id)
  );
}
