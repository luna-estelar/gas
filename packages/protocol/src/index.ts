// @luna-estelar/gas-protocol
// Shared, transport-neutral payload schemas and types used across the GAS
// packages. This package depends on no other GAS package. The v1.0 JSON
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
  ClearTrackTimbreCommand,
  Command,
  DefineTrackCommand,
  OverrideCommand,
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

export type { HostTrack, InputState, Override } from './input-state.js';
export type { EffectiveGlobals, EffectiveState, EffectiveTrack } from './effective-state.js';

export type {
  AppliedPosition,
  CommandResult,
  CompileResult,
  DiagnosticEvent,
  LifecycleEvent,
  LoadResult,
  LiveCommandFailureResult,
  LiveCommandResult,
  LiveCommandSuccess,
  PlaybackPhase,
  PlaybackWarning,
  SessionState,
  SessionWarning,
  TrackView,
  WarningEvent
} from './session.js';

export type {
  AudioChunk,
  AudioFormat,
  AudioSink,
  ClockTimer,
  Connector,
  ConnectorAudioChunk,
  ConnectorConfig,
  ConnectorConfigSchema,
  ConnectorDescription,
  ConnectorFailureReason,
  ConnectorNotation,
  ConnectorSettings,
  ConnectorStreamStatus,
  ConnectorTiming,
  ConnectorUpdate,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ModelInfo,
  MonotonicClock,
  PlaybackStatus,
  Renderer,
  RendererDefaults,
  RendererEventMap,
  RendererFailure,
  RendererLifecycle,
  RendererPositionEvent,
  RendererStatusEvent,
  RendererUpdateResult,
  RendererWarning,
  SampleFormat
} from './renderer.js';

export type { ConnectorErrorOptions } from './errors.js';
export { ConnectorError } from './errors.js';

export const packageName = '@luna-estelar/gas-protocol';
export const version = '0.1.1';
