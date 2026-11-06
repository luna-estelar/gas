import type { AppValueCommand } from './commands.js';
import type { Timeline } from './timeline.js';

export interface AppTrack {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

export type AppValue = AppValueCommand;

// `appValues` holds at most one set-command per slot, in the order they were last set. Clears are
// never stored. Applying the list again gives the same state.
export interface InputState {
  readonly timeline: Timeline;
  readonly appTracks: readonly AppTrack[];
  readonly appValues: readonly AppValue[];
}
