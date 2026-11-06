// GAS command shapes. Core validates and applies them; this module only
// defines the plain values.

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

export interface ClearTrackNotesCommand {
  readonly kind: 'clearTrackNotes';
  readonly trackId: string;
}

export interface ClearTrackMotifCommand {
  readonly kind: 'clearTrackMotif';
  readonly trackId: string;
}

// Hands the track's play/stop state back to the score.
export interface ClearTrackPlayCommand {
  readonly kind: 'clearTrackPlay';
  readonly trackId: string;
}

// Removes an app track and every app value set on it. Document tracks can't be removed.
export interface RemoveTrackCommand {
  readonly kind: 'removeTrack';
  readonly trackId: string;
}

export interface SetTempoCommand {
  readonly kind: 'setTempo';
  readonly bpm: number;
}

export interface ClearTempoCommand {
  readonly kind: 'clearTempo';
}

/** A command that sets or clears one app value. */
export type AppValueCommand =
  | PlayTrackCommand
  | StopTrackCommand
  | ClearTrackPlayCommand
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
  | ClearTrackNotesCommand
  | ClearTrackMotifCommand
  | SetTempoCommand
  | ClearTempoCommand;

export type Command = DefineTrackCommand | RemoveTrackCommand | AppValueCommand;
