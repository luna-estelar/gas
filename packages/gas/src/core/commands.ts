// The canonical command set shared by programmatic API methods and live GAS
// statements, and `applyCommand` — validation, capabilities-driven warnings, and
// application onto the session input state. Commands cross an untyped boundary
// (apps may call from plain JavaScript), so every payload is checked at runtime;
// `applyCommand` never throws and never stores an unchecked value. A failure
// rejects the command and leaves the state untouched; `applyCommands` does the
// same for a whole group.
//
// App values keep one set-command per slot. A set replaces its slot's entry and
// moves it to the end; a clear deletes the entry and is never stored. So the list
// stays bounded however long a session runs, and applying it again gives the
// same state.

import type {
  CapabilitiesTable,
  Command,
  CommandFailure,
  CommandWarning,
  DefineTrackCommand,
  IntentKeyword,
  OverrideCommand,
  RemoveTrackCommand
} from '../protocol/index.js';
import type { AppTrack, InputState } from './state.js';
import { freezeInputState } from './state.js';
import { warningForIntent } from './warnings.js';

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
  CommandFailure,
  CommandFailureCode,
  CommandWarning,
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
} from '../protocol/index.js';

// Commands apply the same way whether or not the music is playing, so the only
// option is the Renderer's capabilities, which drive warnings.
export interface ApplyCommandOptions {
  readonly capabilities: CapabilitiesTable;
}

// The failure branch carries no warnings: validation runs before warning
// production, so a rejected command has produced none.
export type ApplyCommandResult =
  | { readonly ok: true; readonly state: InputState; readonly warnings: readonly CommandWarning[] }
  | { readonly ok: false; readonly failure: CommandFailure };

// `index` is the position of the command that failed.
export type ApplyCommandsResult =
  | { readonly ok: true; readonly state: InputState; readonly warnings: readonly CommandWarning[] }
  | { readonly ok: false; readonly failure: CommandFailure; readonly index: number };

export type DefineTrackResult =
  | { readonly ok: true; readonly state: InputState }
  | { readonly ok: false; readonly failure: CommandFailure };

// Applies a `defineTrack` command. The app-supplied `id` shares the authored
// track namespace, so it must be unique across the timeline's declared tracks
// and any already-defined app tracks; a collision fails the command and leaves
// the state untouched. An identical definition of an existing app track is a
// no-op, so a saved `getState().appValues` can be applied to the session that
// produced it. On success the track joins `appTracks` and begins inactive —
// activity is derived through the cascade, never stored here.
export function defineTrack(state: InputState, command: DefineTrackCommand): DefineTrackResult {
  const shapeFailure = defineTrackShapeFailure(command);
  if (shapeFailure !== undefined) {
    return { ok: false, failure: shapeFailure };
  }

  const { id } = command;
  const existing = state.appTracks.find((track) => track.id === id);
  if (
    existing !== undefined &&
    existing.name === command.name &&
    existing.description === command.description
  ) {
    return { ok: true, state };
  }
  if (trackIdExists(state, id)) {
    return {
      ok: false,
      failure: {
        code: 'duplicate-track',
        trackId: id,
        message: `A track with id "${id}" already exists; each track needs a unique id.`
      }
    };
  }

  const appTrack: AppTrack = Object.freeze({
    id,
    ...(command.name !== undefined ? { name: command.name } : {}),
    ...(command.description !== undefined ? { description: command.description } : {})
  });
  return {
    ok: true,
    state: freezeInputState({ ...state, appTracks: [...state.appTracks, appTrack] })
  };
}

// Removes an app track and every app value set on it. Document tracks belong to
// the score, so removing one fails with `not-app-track`.
export function removeTrack(state: InputState, command: RemoveTrackCommand): DefineTrackResult {
  const loose: unknown = command;
  if (!isObject(loose) || !isNonEmptyString(loose.trackId)) {
    return { ok: false, failure: invalidValue('This command needs a track id.') };
  }
  const trackId = loose.trackId;
  if (!state.appTracks.some((track) => track.id === trackId)) {
    if (state.timeline.tracks.some((track) => track.trackId === trackId)) {
      return {
        ok: false,
        failure: {
          code: 'not-app-track',
          trackId,
          message: `"${trackId}" comes from the document, so it can't be removed.`
        }
      };
    }
    return { ok: false, failure: unknownTrack(trackId) };
  }
  return {
    ok: true,
    state: freezeInputState({
      ...state,
      appTracks: state.appTracks.filter((track) => track.id !== trackId),
      appValues: state.appValues.filter((value) => trackIdOf(value) !== trackId)
    })
  };
}

// Applies commands in order on a working copy. Either every command applies, or
// the first failure comes back and the input state is unchanged.
export function applyCommands(
  state: InputState,
  commands: readonly Command[],
  options: ApplyCommandOptions
): ApplyCommandsResult {
  if (!Array.isArray(commands)) {
    return { ok: false, failure: invalidValue('Commands must be a list.'), index: 0 };
  }
  let working = state;
  const warnings: CommandWarning[] = [];
  for (const [index, command] of commands.entries()) {
    const result = applyCommand(working, command, options);
    if (!result.ok) {
      return { ok: false, failure: result.failure, index };
    }
    working = result.state;
    warnings.push(...result.warnings);
  }
  return { ok: true, state: working, warnings };
}

// Validates one command and applies it to the input state. Failures reject the
// single command only, and the input state is never changed. `capabilities`
// comes from the API's own typed internals, not app data, so only `command` is
// defended at runtime.
export function applyCommand(
  state: InputState,
  command: Command,
  options: ApplyCommandOptions
): ApplyCommandResult {
  const loose: unknown = command;
  if (!isObject(loose) || typeof loose.kind !== 'string') {
    return { ok: false, failure: invalidValue("This isn't a GAS command.") };
  }

  if (loose.kind === 'defineTrack') {
    const result = defineTrack(state, loose as unknown as DefineTrackCommand);
    return result.ok ? { ok: true, state: result.state, warnings: [] } : result;
  }

  if (loose.kind === 'removeTrack') {
    const result = removeTrack(state, loose as unknown as RemoveTrackCommand);
    return result.ok ? { ok: true, state: result.state, warnings: [] } : result;
  }

  if (!OVERRIDE_KINDS.has(loose.kind)) {
    return { ok: false, failure: invalidValue(`"${loose.kind}" isn't a command GAS understands.`) };
  }

  if (TRACK_SCOPED_KINDS.has(loose.kind)) {
    // A wrong address is the more useful failure, so track checks run before
    // payload checks: a bad level on a ghost track reports the ghost track.
    if (!isNonEmptyString(loose.trackId)) {
      return { ok: false, failure: invalidValue('This command needs a track id.') };
    }
    if (!trackIdExists(state, loose.trackId)) {
      return { ok: false, failure: unknownTrack(loose.trackId) };
    }
  }

  const built = buildOverride(loose);
  if ('failure' in built) {
    return { ok: false, failure: built.failure };
  }

  const override = built.override;
  const others = state.appValues.filter((value) => !sameSlot(value, override));
  const appValues = CLEAR_KINDS.has(override.kind) ? others : [...others, override];
  return {
    ok: true,
    state: freezeInputState({ ...state, appValues }),
    warnings: warningsFor(override, options.capabilities)
  };
}

// Whether `id` is already taken in the shared authored + app track namespace.
function trackIdExists(state: InputState, id: string): boolean {
  return (
    state.timeline.tracks.some((track) => track.trackId === id) ||
    state.appTracks.some((track) => track.id === id)
  );
}

// The slot each command writes. A set and its clear share a slot, and so do
// playTrack, stopTrack and clearTrackPlay.
const SLOT_OF: Readonly<Record<OverrideCommand['kind'], string>> = {
  setGlobalFlavor: 'flavor',
  clearGlobalFlavor: 'flavor',
  setGlobalLevel: 'level',
  clearGlobalLevel: 'level',
  setTempo: 'tempo',
  clearTempo: 'tempo',
  playTrack: 'play',
  stopTrack: 'play',
  clearTrackPlay: 'play',
  setTrackFlavor: 'flavor',
  clearTrackFlavor: 'flavor',
  setTrackTimbre: 'timbre',
  clearTrackTimbre: 'timbre',
  setTrackLevel: 'level',
  clearTrackLevel: 'level',
  setTrackNotes: 'notes',
  clearTrackNotes: 'notes',
  setTrackMotif: 'motif',
  clearTrackMotif: 'motif'
};

const CLEAR_KINDS: ReadonlySet<OverrideCommand['kind']> = new Set([
  'clearGlobalFlavor',
  'clearGlobalLevel',
  'clearTempo',
  'clearTrackPlay',
  'clearTrackFlavor',
  'clearTrackTimbre',
  'clearTrackLevel',
  'clearTrackNotes',
  'clearTrackMotif'
]);

function sameSlot(a: OverrideCommand, b: OverrideCommand): boolean {
  return SLOT_OF[a.kind] === SLOT_OF[b.kind] && trackIdOf(a) === trackIdOf(b);
}

// The track an app value belongs to, or undefined for a global value.
export function trackIdOf(override: OverrideCommand): string | undefined {
  return 'trackId' in override ? override.trackId : undefined;
}

function defineTrackShapeFailure(command: DefineTrackCommand): CommandFailure | undefined {
  const loose: unknown = command;
  if (!isObject(loose)) {
    return invalidValue("This isn't a defineTrack command.");
  }
  if (!isNonEmptyString(loose.id)) {
    return invalidValue('A new track needs an id.');
  }
  if (loose.name !== undefined && typeof loose.name !== 'string') {
    return invalidValue('The track name must be text.');
  }
  if (loose.description !== undefined && typeof loose.description !== 'string') {
    return invalidValue('The track description must be text.');
  }
  return undefined;
}

const TRACK_SCOPED_KINDS: ReadonlySet<string> = new Set([
  'playTrack',
  'stopTrack',
  'clearTrackPlay',
  'setTrackFlavor',
  'clearTrackFlavor',
  'setTrackTimbre',
  'clearTrackTimbre',
  'setTrackLevel',
  'clearTrackLevel',
  'setTrackNotes',
  'clearTrackNotes',
  'setTrackMotif',
  'clearTrackMotif'
]);

const OVERRIDE_KINDS: ReadonlySet<string> = new Set([
  ...TRACK_SCOPED_KINDS,
  'setGlobalFlavor',
  'clearGlobalFlavor',
  'setGlobalLevel',
  'clearGlobalLevel',
  'setTempo',
  'clearTempo'
]);

type BuildResult = { readonly override: OverrideCommand } | { readonly failure: CommandFailure };

// Validates an override command's payload and rebuilds its canonical stored copy
// from the declared fields only, frozen — so stray fields never reach the input
// state and the caller cannot mutate an accepted override. The kind is already
// known to be an override kind, and track ids are already resolved.
function buildOverride(command: Record<string, unknown>): BuildResult {
  const kind = command.kind as OverrideCommand['kind'];
  const trackId = command.trackId as string;
  switch (kind) {
    case 'playTrack':
    case 'stopTrack':
    case 'clearTrackPlay':
    case 'clearTrackFlavor':
    case 'clearTrackTimbre':
    case 'clearTrackLevel':
    case 'clearTrackNotes':
    case 'clearTrackMotif':
      return accept({ kind, trackId });
    case 'clearGlobalFlavor':
    case 'clearGlobalLevel':
    case 'clearTempo':
      return accept({ kind });
    case 'setGlobalFlavor':
      return typeof command.value === 'string'
        ? accept({ kind, value: command.value })
        : { failure: invalidValue('The flavor must be text, for example "warm and distant".') };
    case 'setTrackFlavor':
      return typeof command.value === 'string'
        ? accept({ kind, trackId, value: command.value })
        : {
            failure: invalidValue(
              'The flavor must be text, for example "warm and distant".',
              trackId
            )
          };
    case 'setTrackTimbre':
      return typeof command.value === 'string'
        ? accept({ kind, trackId, value: command.value })
        : {
            failure: invalidValue(
              'The timbre must be text, for example "detuned tape piano".',
              trackId
            )
          };
    case 'setTrackNotes':
      return typeof command.alda === 'string'
        ? accept({ kind, trackId, alda: command.alda })
        : { failure: invalidValue('The notes must be alda source text.', trackId) };
    case 'setTrackMotif':
      return typeof command.alda === 'string'
        ? accept({ kind, trackId, alda: command.alda })
        : { failure: invalidValue('The motif must be alda source text.', trackId) };
    case 'setGlobalLevel':
      return isValidLevel(command.value)
        ? accept({ kind, value: command.value })
        : { failure: invalidLevel(command.value) };
    case 'setTrackLevel':
      return isValidLevel(command.value)
        ? accept({ kind, trackId, value: command.value })
        : { failure: { ...invalidLevel(command.value), trackId } };
    case 'setTempo':
      return isValidBpm(command.bpm)
        ? accept({ kind, bpm: command.bpm })
        : {
            failure: {
              code: 'invalid-tempo',
              message: `The tempo is ${describeNumber(command.bpm)}, but it must be at least 1 bpm.`
            }
          };
  }
}

function accept(override: OverrideCommand): BuildResult {
  return { override: Object.freeze(override) };
}

// Which intent keyword each command expresses, driving capabilities warnings.
// Play, stop, clearTrackPlay, and track definitions carry no renderable intent — track activity and
// track identity are structural — so they never warn. Global level is also
// absent because the Renderer owns post-render gain. Other clears warn exactly
// like sets: a clear moves effective state back toward authored values, which
// an unsupported model equally cannot render.
const COMMAND_INTENTS: Readonly<Partial<Record<OverrideCommand['kind'], IntentKeyword>>> = {
  setGlobalFlavor: 'flavor',
  clearGlobalFlavor: 'flavor',
  setTrackFlavor: 'flavor',
  clearTrackFlavor: 'flavor',
  setTrackLevel: 'level',
  clearTrackLevel: 'level',
  setTrackTimbre: 'timbre',
  clearTrackTimbre: 'timbre',
  setTrackNotes: 'notes',
  clearTrackNotes: 'notes',
  setTrackMotif: 'motif',
  clearTrackMotif: 'motif',
  setTempo: 'tempo',
  clearTempo: 'tempo'
};

function warningsFor(
  override: OverrideCommand,
  capabilities: CapabilitiesTable
): readonly CommandWarning[] {
  const intent = COMMAND_INTENTS[override.kind];
  if (intent === undefined) return [];
  const warning = warningForIntent(intent, capabilities, trackIdOf(override));
  return warning === undefined ? [] : [warning];
}

function invalidValue(message: string, trackId?: string): CommandFailure {
  return trackId === undefined
    ? { code: 'invalid-value', message }
    : { code: 'invalid-value', trackId, message };
}

function unknownTrack(trackId: string): CommandFailure {
  return {
    code: 'unknown-track',
    trackId,
    message: `No track with id "${trackId}" exists; define it first or check the id.`
  };
}

function invalidLevel(value: unknown): CommandFailure {
  return {
    code: 'invalid-level',
    message: `The level is ${describeNumber(value)}, but levels run from 0 to 1.`
  };
}

function isValidLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

// At least 1 bpm, fractional allowed — matching the live-language rule.
function isValidBpm(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1;
}

function describeNumber(value: unknown): string {
  return typeof value === 'number' ? String(value) : 'not a number';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
