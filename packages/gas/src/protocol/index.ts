// Types shared across GAS. This module depends on no other GAS module. The JSON
// values have matching schemas under `schemas/1.0/`. Interfaces and binary
// values are defined only here.

export type {
  ArrangementInstance,
  AldaValue,
  BeatOffset,
  BeatPosition,
  FinitePlayback,
  FormatVersion,
  GlobalDefaults,
  InfinitePlayback,
  IntentValue,
  LevelValue,
  LoopPlayback,
  MusicalContext,
  MusicalPosition,
  Playback,
  PlayStopEvent,
  Provenance,
  Resource,
  ResourceManifest,
  ResourceValue,
  SectionFlavorEvent,
  Sha256Digest,
  SourceIdentity,
  SourcePosition,
  SourceRange,
  TextValue,
  Timeline,
  TimelineEvent,
  TimeSignature,
  TrackDeclaration,
  TrackDefault,
  TrackDefaultAction,
  ValuedTrackAction,
  ValuedTrackEvent
} from './timeline.js';

export type { CapabilitiesTable, IntentKeyword, IntentSupport } from './capabilities.js';

export type {
  AppValueDroppedWarning,
  CommandFailure,
  CommandFailureCode,
  CommandWarning,
  GasDiagnostic,
  GasDiagnosticCategory,
  GasDiagnosticSeverity,
  TimelineProblem,
  TimelineProblemCode,
  ValidateTimelineResult
} from './diagnostics.js';

export type {
  AppValueCommand,
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
  DefineTrackCommand,
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

export type { AppTrack, AppValue, InputState } from './input-state.js';
export type { EffectiveGlobals, EffectiveState, EffectiveTrack } from './effective-state.js';

export type {
  AppliedPosition,
  AudiblePositionEvent,
  CommandResult,
  CompileResult,
  DocumentDefaults,
  GenerationPositionEvent,
  LoadResult,
  PlayWarning,
  SessionEnded,
  SessionState,
  SessionStatus,
  SessionWarning,
  SubmitLiveCommandsResult,
  TrackView,
  WarningEvent
} from './session.js';

export type {
  AudioChunk,
  AudioFormat,
  ClockTimer,
  Connection,
  ConnectOptions,
  Connector,
  ConnectorAudioChunk,
  ConnectorConfig,
  ConnectorConfigProblem,
  ConnectorConfigSchema,
  ConnectorConfigValidation,
  ConnectorDescription,
  ConnectorFailureReason,
  ConnectorNotation,
  ConnectorTiming,
  ConnectorUpdate,
  ConnectorWarning,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ModelInfo,
  MonotonicClock,
  SampleFormat
} from './connector.js';

export type { ConnectorErrorOptions } from './errors.js';
export { ConnectorError, isCloseCode } from './errors.js';

export { slugify } from './ids.js';
