// Canonical GAS command shapes shared by Core state, the API, and Renderer
// wiring. Core owns validation and application; Protocol owns only the plain
// transport-neutral values.

export interface DefineTrackCommand {
  readonly kind: 'defineTrack';
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

export interface PlayTrackCommand {
  readonly kind: 'playTrack';
  readonly trackId: string;
}

export interface StopTrackCommand {
  readonly kind: 'stopTrack';
  readonly trackId: string;
}

export interface SetGlobalFlavorCommand {
  readonly kind: 'setGlobalFlavor';
  readonly value: string;
}

export interface ClearGlobalFlavorCommand {
  readonly kind: 'clearGlobalFlavor';
}

export interface SetGlobalLevelCommand {
  readonly kind: 'setGlobalLevel';
  readonly value: number;
}

export interface ClearGlobalLevelCommand {
  readonly kind: 'clearGlobalLevel';
}

export interface SetTrackFlavorCommand {
  readonly kind: 'setTrackFlavor';
  readonly trackId: string;
  readonly value: string;
}

export interface ClearTrackFlavorCommand {
  readonly kind: 'clearTrackFlavor';
  readonly trackId: string;
}

export interface SetTrackTimbreCommand {
  readonly kind: 'setTrackTimbre';
  readonly trackId: string;
  readonly value: string;
}

export interface ClearTrackTimbreCommand {
  readonly kind: 'clearTrackTimbre';
  readonly trackId: string;
}

export interface SetTrackLevelCommand {
  readonly kind: 'setTrackLevel';
  readonly trackId: string;
  readonly value: number;
}

export interface ClearTrackLevelCommand {
  readonly kind: 'clearTrackLevel';
  readonly trackId: string;
}

export interface SetTrackNotesCommand {
  readonly kind: 'setTrackNotes';
  readonly trackId: string;
  readonly alda: string;
}

export interface SetTrackMotifCommand {
  readonly kind: 'setTrackMotif';
  readonly trackId: string;
  readonly alda: string;
}

export interface SetTempoCommand {
  readonly kind: 'setTempo';
  readonly bpm: number;
}

export interface ClearTempoCommand {
  readonly kind: 'clearTempo';
}

export type OverrideCommand =
  | PlayTrackCommand
  | StopTrackCommand
  | SetGlobalFlavorCommand
  | ClearGlobalFlavorCommand
  | SetGlobalLevelCommand
  | ClearGlobalLevelCommand
  | SetTrackFlavorCommand
  | ClearTrackFlavorCommand
  | SetTrackTimbreCommand
  | ClearTrackTimbreCommand
  | SetTrackLevelCommand
  | ClearTrackLevelCommand
  | SetTrackNotesCommand
  | SetTrackMotifCommand
  | SetTempoCommand
  | ClearTempoCommand;

export type Command = DefineTrackCommand | OverrideCommand;
