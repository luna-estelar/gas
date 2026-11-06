// Session state and commands, as pure functions.

export type { AppTrack, InputState, AppValue } from './state.js';
export { createInputState } from './state.js';

export type {
  ApplyCommandOptions,
  ApplyCommandResult,
  ApplyCommandsResult,
  ClearGlobalFlavorCommand,
  ClearGlobalLevelCommand,
  ClearTempoCommand,
  ClearTrackFlavorCommand,
  ClearTrackLevelCommand,
  ClearTrackMotifCommand,
  ClearTrackNotesCommand,
  ClearTrackPlayCommand,
  ClearTrackTimbreCommand,
  Command,
  CommandFailure,
  CommandFailureCode,
  CommandWarning,
  DefineTrackCommand,
  DefineTrackResult,
  AppValueCommand,
  PlayTrackCommand,
  RemoveTrackCommand,
  SetGlobalFlavorCommand,
  SetGlobalLevelCommand,
  SetTempoCommand,
  SetTrackFlavorCommand,
  SetTrackLevelCommand,
  SetTrackMotifCommand,
  SetTrackNotesCommand,
  SetTrackTimbreCommand,
  StopTrackCommand
} from './commands.js';
export { applyCommand, applyCommands, defineTrack, removeTrack } from './commands.js';
export { warningsForTimeline } from './warnings.js';

export type { TimelineProblem, TimelineProblemCode, ValidateTimelineResult } from './validate.js';
export { validateTimeline } from './validate.js';

export { comparePositions, positionsEqual } from './positions.js';

export type { ResolvedTiming, TempoSegment, TempoSegmentMap } from './musical-time.js';
export {
  barToTime,
  createTempoSegmentMap,
  DEFAULT_TEMPO,
  DEFAULT_TIME_SIGNATURE,
  positionToTime,
  reanchorTempo,
  resolveTiming,
  secondsPerBar,
  secondsPerBeat,
  TICKS_PER_BEAT,
  timeToBarFraction,
  timeToPosition
} from './musical-time.js';

export type {
  EffectiveGlobals,
  EffectiveState,
  EffectiveStateOptions,
  EffectiveTrack
} from './cascade.js';
export { effectiveStateAt, sectionInstanceAt } from './cascade.js';

export { authoredEventSchedule } from './schedule.js';

export type { AppValuesMode, NewTimelineResult } from './transitions.js';
export { applyNewTimeline } from './transitions.js';
