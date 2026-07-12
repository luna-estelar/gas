// @luna-estelar/gas-protocol
// Shared, transport-neutral payload schemas and types used across the GAS
// packages. This package depends on no other GAS package. The v1.0 JSON
// schemas ship under `schemas/1.0/`; the TypeScript contracts promoted so far
// are the compiled timeline and the renderer capabilities table.

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

export const packageName = '@luna-estelar/gas-protocol';
export const version = '0.1.0';
