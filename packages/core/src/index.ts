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

export type { TimelineProblem, TimelineProblemCode, ValidateTimelineResult } from './validate.js';
export { validateTimeline } from './validate.js';

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
export const version = '0.1.0';
