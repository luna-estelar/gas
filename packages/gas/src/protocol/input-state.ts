import type { OverrideCommand } from './commands.js';
import type { Timeline } from './timeline.js';

export interface HostTrack {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

export type Override = OverrideCommand;

export interface InputState {
  readonly timeline: Timeline;
  readonly hostTracks: readonly HostTrack[];
  readonly staged: readonly Override[];
  readonly live: readonly Override[];
}
