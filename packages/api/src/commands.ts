// Convert live statements to Core commands, resolving track names to IDs.
// Core validates unresolved references and generated track IDs.

import type { Command } from '@luna-estelar/gas-protocol';
import type { InputState } from '@luna-estelar/gas-core';
import type { LiveStatement } from '@luna-estelar/gas-language';
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
    case 'Tempo':
      return { kind: 'setTempo', bpm: statement.bpm };
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

function refId(state: InputState, reference: string): string {
  return resolveTrackId(state, reference) ?? reference;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled live statement: ${JSON.stringify(value)}`);
}
