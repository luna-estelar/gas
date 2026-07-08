export interface GasSourcePosition {
  readonly line: number;
  readonly character: number;
}

export interface GasSourceRange {
  readonly start: GasSourcePosition;
  readonly end: GasSourcePosition;
}

export interface GasNode {
  readonly kind: string;
  readonly range: GasSourceRange;
  readonly sourceOrder: number;
}

export interface GasDocument extends GasNode {
  readonly kind: 'Document';
  readonly globals: Globals;
  readonly tracks: readonly Track[];
  readonly tracksByName: ReadonlyMap<string, Track>;
  readonly sections: readonly Section[];
  readonly sectionsByName: ReadonlyMap<string, Section>;
  readonly arrangement: readonly SectionPlay[];
  readonly orphanCommands: readonly TrackCommand[];
}

export interface Globals {
  readonly tempo?: TempoGlobal;
  readonly key?: KeyGlobal;
  readonly timeSignature?: TimeSignatureGlobal;
  readonly length?: GlobalLength;
  readonly flavor?: FlavorGlobal;
  readonly level?: LevelGlobal;
  readonly all: readonly Global[];
}

export type Global =
  | TempoGlobal
  | KeyGlobal
  | TimeSignatureGlobal
  | GlobalLength
  | FlavorGlobal
  | LevelGlobal;

export interface TempoGlobal extends GasNode {
  readonly kind: 'Tempo';
  readonly bpm: number;
}

export interface KeyGlobal extends GasNode {
  readonly kind: 'Key';
  readonly value: string;
}

export interface TimeSignatureGlobal extends GasNode {
  readonly kind: 'TimeSignature';
  readonly numerator: number;
  readonly denominator: number;
}

export interface GlobalLength extends GasNode {
  readonly kind: 'Length';
  readonly mode: 'finite' | 'loop' | 'infinite';
  readonly bars?: number;
}

export interface SectionLength extends GasNode {
  readonly kind: 'SectionLength';
  readonly bars: number;
}

export interface FlavorGlobal extends GasNode {
  readonly kind: 'Flavor';
  readonly value: string;
}

export interface LevelGlobal extends GasNode {
  readonly kind: 'Level';
  readonly value: number;
}

export interface Track extends GasNode {
  readonly kind: 'Track';
  readonly name: string;
  readonly description: string;
  readonly defaults: readonly TrackCommand[];
}

export interface Section extends GasNode {
  readonly kind: 'Section';
  readonly name: string;
  readonly length?: SectionLength;
  readonly flavors: readonly FlavorGlobal[];
  readonly setup: readonly TrackCommand[];
  readonly bars: readonly Bar[];
}

export interface Bar extends GasNode {
  readonly kind: 'Bar';
  readonly number: number;
  readonly commands: readonly TrackCommand[];
}

export type TrackCommand =
  | PlayCommand
  | StopCommand
  | FlavorCommand
  | TimbreCommand
  | LevelCommand
  | NotesCommand
  | MotifCommand;

export interface TrackCommandBase extends GasNode {
  readonly trackName: string;
}

export interface PlayCommand extends TrackCommandBase {
  readonly kind: 'Play';
}

export interface StopCommand extends TrackCommandBase {
  readonly kind: 'Stop';
}

export interface FlavorCommand extends TrackCommandBase {
  readonly kind: 'Flavor';
  readonly value: string;
}

export interface TimbreCommand extends TrackCommandBase {
  readonly kind: 'Timbre';
  readonly value: StringValue;
}

export interface LevelCommand extends TrackCommandBase {
  readonly kind: 'Level';
  readonly value: number;
}

export interface NotesCommand extends TrackCommandBase {
  readonly kind: 'Notes';
  readonly value: AldaSnippet;
}

export interface MotifCommand extends TrackCommandBase {
  readonly kind: 'Motif';
  readonly value: AldaSnippet;
}

export interface SectionPlay extends GasNode {
  readonly kind: 'SectionPlay';
  readonly sectionName: string;
}

export interface StringValue extends GasNode {
  readonly kind: 'String';
  readonly value: string;
}

export interface AldaSnippet extends GasNode {
  readonly kind: 'Alda';
  readonly raw: string;
}

export function resolveTrack(document: GasDocument, command: TrackCommandBase): Track | undefined {
  return document.tracksByName.get(command.trackName);
}

export function resolveSection(document: GasDocument, call: SectionPlay): Section | undefined {
  return document.sectionsByName.get(call.sectionName);
}

export function effectiveLengthBars(section: Section, globals: Globals): number | undefined {
  if (section.length !== undefined) {
    return section.length.bars;
  }
  return globals.length?.mode === 'finite' || globals.length?.mode === 'loop'
    ? globals.length.bars
    : undefined;
}

export function isLiteral(command: TrackCommand): boolean {
  return command.kind === 'Notes';
}
