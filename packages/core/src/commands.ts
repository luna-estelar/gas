// The canonical command set shared by programmatic API methods and live GAS
// statements, and `applyCommand` — validation, capabilities-driven warnings, and
// application onto the session input state. Commands cross an untyped boundary
// (hosts may call from plain JavaScript), so every payload is checked at runtime;
// `applyCommand` never throws and never stores an unchecked value. A failure
// rejects the single command and leaves the state untouched.

import type {
  CapabilitiesTable,
  Command,
  DefineTrackCommand,
  IntentKeyword,
  IntentSupport,
  OverrideCommand
} from '@luna-estelar/gas-protocol';
import type { InputState, HostTrack } from './state.js';
import { freezeInputState } from './state.js';

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
} from '@luna-estelar/gas-protocol';

// Define a host track. Phase-independent: host tracks are not overrides, so this
// applies the same whether the session is stopped or active.
// Caller-supplied playback phase: commands applied while stopped create staged
// overrides; commands applied while starting, playing, or holding create live
// overrides. Core owns no clock, so it never knows the phase on its own.
export type PlaybackPhase = 'stopped' | 'active';

// Structured command failures, keyed by a stable code with a musician-friendly
// message. `invalid-value` covers text-shaped payloads, track ids, and commands
// GAS does not recognize; out-of-range or non-numeric levels and tempos keep
// their own codes.
export type CommandFailureCode =
  | 'duplicate-track'
  | 'unknown-track'
  | 'invalid-level'
  | 'invalid-tempo'
  | 'invalid-value';

export interface CommandFailure {
  readonly code: CommandFailureCode;
  readonly message: string;
  readonly trackId?: string;
}

// One warning per command: a command expresses at most one intent keyword, and
// the capabilities table decides its support. Warnings never block a command and
// never touch sibling state; `warningId` allocation is the API's job, so Core
// returns plain objects. The `support` field lets hosts style approximated and
// unsupported intent differently without parsing copy.
export interface CommandWarning {
  readonly code: 'unsupported-intent';
  readonly intent: IntentKeyword;
  readonly support: Exclude<IntentSupport, 'supported'>;
  readonly trackId?: string;
  readonly message: string;
}

export interface ApplyCommandOptions {
  readonly phase: PlaybackPhase;
  readonly capabilities: CapabilitiesTable;
}

// The failure branch carries no warnings: validation runs before warning
// production, so a rejected command has produced none. (The API layer may batch
// warnings across a multi-statement live submission — that is its concern, not
// a per-command one.)
export type ApplyCommandResult =
  | { readonly ok: true; readonly state: InputState; readonly warnings: readonly CommandWarning[] }
  | { readonly ok: false; readonly failure: CommandFailure };

export type DefineTrackResult =
  | { readonly ok: true; readonly state: InputState }
  | { readonly ok: false; readonly failure: CommandFailure };

// Applies a `defineTrack` command. The host-supplied `id` shares the authored
// track namespace, so it must be unique across the timeline's declared tracks
// and any already-defined host tracks; a collision fails the command and leaves
// the state untouched. On success the track joins `hostTracks` and begins
// inactive — activity is derived through the cascade, never stored here.
export function defineTrack(state: InputState, command: DefineTrackCommand): DefineTrackResult {
  const shapeFailure = defineTrackShapeFailure(command);
  if (shapeFailure !== undefined) {
    return { ok: false, failure: shapeFailure };
  }

  const { id } = command;
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

  const hostTrack: HostTrack = Object.freeze({
    id,
    ...(command.name !== undefined ? { name: command.name } : {}),
    ...(command.description !== undefined ? { description: command.description } : {})
  });
  return {
    ok: true,
    state: freezeInputState({ ...state, hostTracks: [...state.hostTracks, hostTrack] })
  };
}

// Validates one command and applies it to the input state. Failures reject the
// single command only — the returned state on the failure branch is never
// consulted, and the input state is never changed. `phase` and `capabilities`
// come from the API's own typed internals, not host data, so only `command` is
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
      return {
        ok: false,
        failure: {
          code: 'unknown-track',
          trackId: loose.trackId,
          message: `No track with id "${loose.trackId}" exists; define it first or check the id.`
        }
      };
    }
  }

  const built = buildOverride(loose);
  if ('failure' in built) {
    return { ok: false, failure: built.failure };
  }

  const override = built.override;
  const next =
    options.phase === 'stopped'
      ? { ...state, staged: [...state.staged, override] }
      : { ...state, live: [...state.live, override] };
  return {
    ok: true,
    state: freezeInputState(next),
    warnings: warningsFor(override, options.capabilities)
  };
}

// Whether `id` is already taken in the shared authored + host track namespace.
function trackIdExists(state: InputState, id: string): boolean {
  return (
    state.timeline.tracks.some((track) => track.trackId === id) ||
    state.hostTracks.some((track) => track.id === id)
  );
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
  'setTrackFlavor',
  'clearTrackFlavor',
  'setTrackTimbre',
  'clearTrackTimbre',
  'setTrackLevel',
  'clearTrackLevel',
  'setTrackNotes',
  'setTrackMotif'
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
    case 'clearTrackFlavor':
    case 'clearTrackTimbre':
    case 'clearTrackLevel':
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
// Play, stop, and defineTrack carry no renderable intent — track activity and
// track identity are structural — so they never warn. Clears warn exactly like
// sets: a clear moves effective state back toward authored values, which an
// unsupported model equally cannot render; softening that signal is the API's
// presentation concern, not Core's.
const COMMAND_INTENTS: Readonly<Partial<Record<OverrideCommand['kind'], IntentKeyword>>> = {
  setGlobalFlavor: 'flavor',
  clearGlobalFlavor: 'flavor',
  setTrackFlavor: 'flavor',
  clearTrackFlavor: 'flavor',
  setGlobalLevel: 'level',
  clearGlobalLevel: 'level',
  setTrackLevel: 'level',
  clearTrackLevel: 'level',
  setTrackTimbre: 'timbre',
  clearTrackTimbre: 'timbre',
  setTrackNotes: 'notes',
  setTrackMotif: 'motif',
  setTempo: 'tempo',
  clearTempo: 'tempo'
};

// Total over IntentKeyword so the record typechecks; `key` and `time_signature`
// are authored-only intents no command expresses, so they are unreachable here.
const INTENT_NOUNS: Readonly<Record<IntentKeyword, string>> = {
  flavor: 'flavor',
  key: 'key changes',
  tempo: 'tempo changes',
  time_signature: 'time signatures',
  timbre: 'timbre',
  level: 'level',
  notes: 'notes',
  motif: 'motifs'
};

function warningsFor(
  override: OverrideCommand,
  capabilities: CapabilitiesTable
): readonly CommandWarning[] {
  const intent = COMMAND_INTENTS[override.kind];
  if (intent === undefined) {
    return [];
  }
  const support = capabilities.intents[intent];
  if (support === 'supported') {
    return [];
  }
  const noun = INTENT_NOUNS[intent];
  const message =
    support === 'unsupported'
      ? `This model doesn't support ${noun}; the change is kept, but it may not be heard.`
      : `This model approximates ${noun}; what you hear may not match exactly.`;
  return [
    {
      code: 'unsupported-intent',
      intent,
      support,
      ...('trackId' in override ? { trackId: override.trackId } : {}),
      message
    }
  ];
}

function invalidValue(message: string, trackId?: string): CommandFailure {
  return trackId === undefined
    ? { code: 'invalid-value', message }
    : { code: 'invalid-value', trackId, message };
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
