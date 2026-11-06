// Convert live statements to Core commands, resolving track names to IDs.
// Core validates unresolved references and generated track IDs.

import type { Command } from '../protocol/index.js';
import type { InputState } from '../core/index.js';
import type { LiveGlobalClear, LiveStatement, LiveTrackClear } from '../language/index.js';
import { liveTrackId, resolveTrackId } from './resolve.js';

export function liveStatementToCommand(statement: LiveStatement, state: InputState): Command {
  switch (statement.kind) {
    case 'DeclareTrack':
      return {
        kind: 'defineTrack',
        id: liveTrackId(statement.name),
        name: statement.name,
        ...(statement.description !== '' ? { description: statement.description } : {})
      };
    case 'RemoveTrack':
      return { kind: 'removeTrack', trackId: refId(state, statement.name) };
    case 'Tempo':
      return { kind: 'setTempo', bpm: statement.bpm };
    case 'GlobalFlavor':
      return { kind: 'setGlobalFlavor', value: statement.value };
    case 'GlobalLevel':
      return { kind: 'setGlobalLevel', value: statement.value };
    case 'ClearGlobal':
      return GLOBAL_CLEARS[statement.slot];
    case 'ClearTrack':
      return { kind: TRACK_CLEARS[statement.slot], trackId: refId(state, statement.trackName) };
    case 'Release':
      return { kind: 'clearTrackPlay', trackId: refId(state, statement.trackName) };
    case 'Play':
      return { kind: 'playTrack', trackId: refId(state, statement.trackName) };
    case 'Stop':
      return { kind: 'stopTrack', trackId: refId(state, statement.trackName) };
    case 'Flavor':
      return {
        kind: 'setTrackFlavor',
        trackId: refId(state, statement.trackName),
        value: statement.value
      };
    case 'Timbre':
      return {
        kind: 'setTrackTimbre',
        trackId: refId(state, statement.trackName),
        value: statement.value.value
      };
    case 'Level':
      return {
        kind: 'setTrackLevel',
        trackId: refId(state, statement.trackName),
        value: statement.value
      };
    case 'Notes':
      return {
        kind: 'setTrackNotes',
        trackId: refId(state, statement.trackName),
        alda: statement.value.raw
      };
    case 'Motif':
      return {
        kind: 'setTrackMotif',
        trackId: refId(state, statement.trackName),
        alda: statement.value.raw
      };
    default:
      return assertNever(statement);
  }
}

const GLOBAL_CLEARS = {
  tempo: { kind: 'clearTempo' },
  flavor: { kind: 'clearGlobalFlavor' },
  level: { kind: 'clearGlobalLevel' }
} as const satisfies Record<LiveGlobalClear['slot'], Command>;

const TRACK_CLEARS = {
  flavor: 'clearTrackFlavor',
  timbre: 'clearTrackTimbre',
  level: 'clearTrackLevel',
  notes: 'clearTrackNotes',
  motif: 'clearTrackMotif'
} as const satisfies Record<LiveTrackClear['slot'], Command['kind']>;

function refId(state: InputState, reference: string): string {
  return resolveTrackId(state, reference) ?? reference;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled live statement: ${JSON.stringify(value)}`);
}
