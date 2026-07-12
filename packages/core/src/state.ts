// The session input state: everything the host has asked for, stored as plain
// immutable data. Only Core functions create or transform it, and every
// transform returns a new frozen value — Core never mutates its inputs. Nothing
// position-dependent lives here; effective state at a musical position is
// derived through the cascade, never stored.

import type { Timeline } from '@luna-estelar/gas-protocol';
import type { OverrideCommand } from './commands.js';

// A host-defined track. Shares the authored track namespace (`Timeline.tracks`),
// so its `id` must be unique across both. Host tracks begin inactive; whether a
// track is active at a position is an effective-state fact derived through the
// cascade, not stored here.
export interface HostTrack {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

// An accepted override — a canonical command applied during a run, stored
// verbatim in application order (the cascade reads staged as layer 3 and live as
// layer 5). `defineTrack` is deliberately not an override: host tracks live in
// `hostTracks`. The import from the commands module is type-only, so its value
// imports from this file create no runtime cycle.
export type Override = OverrideCommand;

export interface InputState {
  readonly timeline: Timeline;
  readonly hostTracks: readonly HostTrack[];
  readonly staged: readonly Override[];
  readonly live: readonly Override[];
}

// Creates the initial input state for a document: the loaded timeline, no host
// tracks, and no overrides. Timeline replacement is this same call with the new
// timeline — nothing from a previous document survives except by the host
// re-issuing `defineTrack`.
export function createInputState(timeline: Timeline): InputState {
  return freezeInputState({ timeline, hostTracks: [], staged: [], live: [] });
}

// Freezes an input state and its owned arrays so callers cannot mutate a value
// Core returned. The timeline itself is the caller's value, referenced as-is and
// never mutated.
export function freezeInputState(state: InputState): InputState {
  Object.freeze(state.hostTracks);
  Object.freeze(state.staged);
  Object.freeze(state.live);
  return Object.freeze(state);
}
