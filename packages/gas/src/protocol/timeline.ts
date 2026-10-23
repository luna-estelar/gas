// Canonical TypeScript types describing the compiled GAS timeline. These mirror
// the protocol timeline schema (schemas/1.0/timeline.schema.json) one-to-one.
// The timeline is the shared contract between the compiler that produces it and
// the Core semantics that read it. Nothing here depends on Langium; the timeline
// is plain, model-independent, musical-time data (absolute 1-based bars only —
// no seconds, timestamps, or durations).

export interface FormatVersion {
  readonly major: 1;
  readonly minor: 0;
}

export interface SourcePosition {
  readonly line: number;
  readonly character: number;
}

export interface SourceRange {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface SourceIdentity {
  readonly name?: string;
  readonly mediaType?: string;
  readonly byteLength?: number;
}

export interface BeatOffset {
  readonly numerator: number;
  readonly denominator: number;
}

export interface BeatPosition {
  readonly index: number;
  readonly offset?: BeatOffset;
}

export interface MusicalPosition {
  readonly bar: number;
  readonly beat?: BeatPosition;
}

export interface Provenance {
  readonly sourceRange?: SourceRange;
  readonly sectionName?: string;
  readonly sectionInstanceId?: string;
  readonly callIndex?: number;
  readonly sectionPosition?: MusicalPosition;
}

// Intent value kinds (resources.schema.json). `notes`/`motif` carry opaque alda
// source verbatim; `timbre`/`flavor` are text; `level` is a 0..1 gain.
export interface TextValue {
  readonly kind: 'text';
  readonly text: string;
}

export interface AldaValue {
  readonly kind: 'alda';
  readonly source: string;
}

export interface ResourceValue {
  readonly kind: 'resource';
  readonly resourceId: string;
}

export interface LevelValue {
  readonly kind: 'level';
  readonly value: number;
}

export type IntentValue = TextValue | AldaValue | ResourceValue | LevelValue;

export interface Sha256Digest {
  readonly algorithm: 'sha-256';
  readonly value: string;
}

export interface Resource {
  readonly resourceId: string;
  readonly kind: 'audio' | 'midi' | 'musicxml' | 'text' | 'other';
  readonly uri: string;
  readonly mediaType: string;
  readonly digest?: Sha256Digest;
  readonly provenance?: Provenance;
}

export type ResourceManifest = readonly Resource[];

export interface FinitePlayback {
  readonly mode: 'finite';
  readonly declaredBars: number;
}

export interface LoopPlayback {
  readonly mode: 'loop';
  readonly declaredBars: number;
}

export interface InfinitePlayback {
  readonly mode: 'infinite';
}

export type Playback = FinitePlayback | LoopPlayback | InfinitePlayback;

export interface TimeSignature {
  readonly beatsPerBar: number;
  readonly beatUnit: number;
}

export interface MusicalContext {
  readonly tempo?: number;
  readonly timeSignature?: TimeSignature;
  readonly key?: string;
}

export interface GlobalDefaults {
  readonly flavor?: TextValue;
  readonly level?: LevelValue;
}

export type TrackDefaultAction = 'flavor' | 'timbre' | 'notes' | 'motif' | 'level';

export interface TrackDefault {
  readonly defaultId: string;
  readonly action: TrackDefaultAction;
  readonly value: IntentValue;
  readonly provenance?: Provenance;
}

export interface TrackDeclaration {
  readonly trackId: string;
  readonly name: string;
  readonly description: string;
  readonly defaults: readonly TrackDefault[];
  readonly provenance?: Provenance;
}

export interface ArrangementInstance {
  readonly sectionInstanceId: string;
  readonly sectionName: string;
  readonly callIndex: number;
  readonly start: MusicalPosition;
  readonly end: MusicalPosition;
  readonly provenance?: Provenance;
}

export interface PlayStopEvent {
  readonly eventId: string;
  readonly type: 'track';
  readonly targetId: string;
  readonly action: 'play' | 'stop';
  readonly position: MusicalPosition;
  readonly sequence: number;
  readonly scope: 'timed';
  readonly sectionInstanceId?: string;
  readonly provenance?: Provenance;
}

export type ValuedTrackAction = 'flavor' | 'timbre' | 'notes' | 'motif' | 'level';

export interface ValuedTrackEvent {
  readonly eventId: string;
  readonly type: 'track';
  readonly targetId: string;
  readonly action: ValuedTrackAction;
  readonly position: MusicalPosition;
  readonly sequence: number;
  readonly scope: 'timed' | 'section';
  readonly sectionInstanceId?: string;
  readonly value: IntentValue;
  readonly provenance?: Provenance;
}

export interface SectionFlavorEvent {
  readonly eventId: string;
  readonly type: 'section';
  readonly targetId: string;
  readonly action: 'flavor';
  readonly position: MusicalPosition;
  readonly sequence: number;
  readonly scope: 'section';
  readonly sectionInstanceId: string;
  readonly value: TextValue;
  readonly provenance?: Provenance;
}

export type TimelineEvent = PlayStopEvent | ValuedTrackEvent | SectionFlavorEvent;

export interface Timeline {
  readonly formatVersion: FormatVersion;
  readonly timelineId: string;
  readonly languageVersion: string;
  readonly compilerVersion: string;
  readonly source: SourceIdentity;
  readonly playback: Playback;
  readonly arrangedBars: number;
  readonly musicalContext?: MusicalContext;
  readonly globals: GlobalDefaults;
  readonly tracks: readonly TrackDeclaration[];
  readonly arrangement: readonly ArrangementInstance[];
  readonly resources: ResourceManifest;
  readonly events: readonly TimelineEvent[];
}
