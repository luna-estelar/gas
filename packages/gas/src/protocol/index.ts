// Shared, transport-neutral payload schemas and types used across GAS. This
// module depends on no other GAS module. The v1.0 JSON
// schemas ship under `schemas/1.0/`; JSON-compatible value contracts have
// matching schemas, while service interfaces and binary values remain
// canonical TypeScript contracts.

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
  OverrideCommand,
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

export type { AppTrack, InputState, Override } from './input-state.js';
export type { EffectiveGlobals, EffectiveState, EffectiveTrack } from './effective-state.js';

export type {
  AppliedPosition,
  CommandResult,
  CompileResult,
  DocumentDefaults,
  GenerationPositionEvent,
  LoadResult,
  LiveCommandResult,
  LiveCommandSuccess,
  PlaybackWarning,
  SessionEnded,
  SessionState,
  SessionStatus,
  SessionWarning,
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
  ConnectorSettings,
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
