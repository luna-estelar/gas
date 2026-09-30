// Pure session state, command and lifecycle semantics.

export type { HostTrack, InputState, Override } from './state.js';
export { createInputState } from './state.js';

export type {
  ApplyCommandOptions,
  ApplyCommandResult,
  ClearGlobalFlavorCommand,
  ClearGlobalLevelCommand,
  ClearTempoCommand,
  ClearTrackFlavorCommand,
  ClearTrackLevelCommand,
  ClearTrackTimbreCommand,
  Command,
  CommandFailure,
  CommandFailureCode,
  CommandWarning,
  DefineTrackCommand,
  DefineTrackResult,
  OverrideCommand,
  PlaybackPhase,
  PlayTrackCommand,
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
export { applyCommand, defineTrack } from './commands.js';
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

export { applyStop, applyCompletion, applyLoopBoundary, applyRetry } from './transitions.js';

export const packageName = '@luna-estelar/gas-core';
export const version = '0.1.1';
