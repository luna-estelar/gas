// Pure session state, command and lifecycle semantics.

export type { HostTrack, InputState, Override } from './state.js';
export { createInputState } from './state.js';

export type {
  CommandFailure,
  CommandFailureCode,
  DefineTrackCommand,
  DefineTrackResult
} from './commands.js';
export { defineTrack } from './commands.js';

export type { TimelineProblem, TimelineProblemCode, ValidateTimelineResult } from './validate.js';
export { validateTimeline } from './validate.js';

export const packageName = '@luna-estelar/gas-core';
export const version = '0.1.0';
