// Pure mapping from game state to score actions, shared by playback and visualizations.
import { inventoryCount, entityName } from './bridge.js';
import type { BeatId, BitsyBridgeMessage, GameSnapshot } from './types.js';

/** A score action with a human-readable cause for playback traces and visualizations. */
export type MusicalAction =
  | { readonly kind: 'beat'; readonly beat: BeatId; readonly event: string }
  | { readonly kind: 'tempo'; readonly bpm: number; readonly event: string }
  | { readonly kind: 'global-level'; readonly value: number; readonly event: string }
  | {
      readonly kind: 'track-level';
      readonly track: string;
      readonly value: number;
      readonly event: string;
    }
  | { readonly kind: 'play-track'; readonly track: string; readonly event: string }
  | { readonly kind: 'stop-track'; readonly track: string; readonly event: string }
  | { readonly kind: 'ending'; readonly event: string };

export interface GameReaction {
  /** Room changes update editor focus immediately, including while playback is stopped. */
  readonly selectBeat?: BeatId;
  /** `game-ready` after a playthrough: the game restarted, so the score must. */
  readonly reset: boolean;
  /** In order. Meaningful only where there is a session to apply them to. */
  readonly actions: readonly MusicalAction[];
}

const MARTIAN_DIALOGS = new Set(['martian hungry', 'martian pad guard', 'martian pantry guard']);

const NOTHING: GameReaction = { reset: false, actions: [] };

export function roomBeat(name: string | null): BeatId | undefined {
  switch (name?.toLowerCase()) {
    case 'andromeda':
      return 'room-andromeda';
    case 'milky way':
      return 'room-milky-way';
    case 'kuiper belt west':
      return 'room-kuiper-west';
    case 'kuiper belt east':
      return 'room-kuiper-east';
    case 'galle beach':
      return 'room-galle';
    default:
      return undefined;
  }
}

export function asteroidLevels(hits: number): { global: number; pulse: number } | undefined {
  if (!Number.isFinite(hits) || hits < 1) return undefined;
  if (hits < 2) return { global: 0.85, pulse: 0.55 };
  if (hits < 3) return { global: 0.9, pulse: 0.7 };
  if (hits < 4) return { global: 0.95, pulse: 0.85 };
  return { global: 1, pulse: 1 };
}

/** Room-entry actions. Galle Beach applies tempo and level changes before selecting the beat. */
export function roomActions(beat: BeatId, snapshot: GameSnapshot): readonly MusicalAction[] {
  const arrival: readonly MusicalAction[] =
    beat === 'room-galle'
      ? [
          { kind: 'tempo', bpm: 76, event: 'room-enter: galle beach' },
          { kind: 'global-level', value: 0.8, event: 'room-enter: galle beach' }
        ]
      : [];
  return [
    ...arrival,
    { kind: 'beat', beat, event: `room-enter: ${snapshot.room.name ?? 'unknown room'}` }
  ];
}

function asteroidActions(hits: number, event: string): readonly MusicalAction[] {
  const levels = asteroidLevels(hits);
  if (levels === undefined) return [];
  return [
    { kind: 'global-level', value: levels.global, event },
    { kind: 'track-level', track: 'pulse', value: levels.pulse, event }
  ];
}

function dialogActions(
  name: string,
  snapshot: GameSnapshot
): readonly MusicalAction[] | { readonly beat: BeatId; readonly event: string } {
  if (name === 'wormhole' && inventoryCount(snapshot, 'carrier suit') < 1) {
    return { beat: 'failed-crossing', event: 'wormhole without carrier suit' };
  }
  if (MARTIAN_DIALOGS.has(name)) return { beat: 'martian-dialog', event: name };
  if (name === 'alien saucer' && inventoryCount(snapshot, 'space snack') > 0) {
    return [{ kind: 'tempo', bpm: 116, event: 'successful saucer interaction' }];
  }
  if (name === 'earth approach') {
    const event = 'earth approach: out of GAS';
    return [
      { kind: 'stop-track', track: 'pulse', event },
      { kind: 'stop-track', track: 'bass', event },
      { kind: 'stop-track', track: 'texture', event },
      { kind: 'global-level', value: 0.25, event }
    ];
  }
  if (name === 'beach mat ending') return [{ kind: 'ending', event: 'beach mat ending' }];
  return [];
}

/** Map a bridge message to score actions; compare inventory with the previous snapshot. */
export function reactToGameEvent(
  message: BitsyBridgeMessage,
  previous: GameSnapshot
): GameReaction {
  const snapshot: GameSnapshot = {
    room: message.room,
    inventory: message.inventory,
    variables: message.variables
  };

  if (message.event === 'room-enter') {
    const beat = roomBeat(snapshot.room.name);
    if (beat === undefined) return NOTHING;
    return { selectBeat: beat, reset: false, actions: roomActions(beat, snapshot) };
  }

  if (message.event === 'game-ready') return { reset: true, actions: [] };

  if (message.event === 'inventory-change') {
    const name = entityName(message.detail);
    if (name === undefined) return NOTHING;
    if (inventoryCount(snapshot, name) <= inventoryCount(previous, name)) return NOTHING;
    if (name === 'carrier suit') {
      return {
        reset: false,
        actions: [{ kind: 'play-track', track: 'hope', event: 'carrier suit acquired' }]
      };
    }
    if (name === 'king coconut') {
      return {
        reset: false,
        actions: [{ kind: 'beat', beat: 'coconut-pickup', event: 'king coconut acquired' }]
      };
    }
    return NOTHING;
  }

  if (message.event === 'variable-change') {
    const detail = message.detail as { readonly name?: unknown; readonly value?: unknown };
    if (detail?.name !== 'hits' || typeof detail.value !== 'number') return NOTHING;
    return { reset: false, actions: asteroidActions(detail.value, 'asteroid collision') };
  }

  if (message.event !== 'dialog-start') return NOTHING;
  const name = entityName(message.detail);
  if (name === undefined) return NOTHING;
  const outcome = dialogActions(name, snapshot);
  if (Array.isArray(outcome)) return { reset: false, actions: outcome };
  const { beat, event } = outcome as { beat: BeatId; event: string };
  return { reset: false, actions: [{ kind: 'beat', beat, event }] };
}

/** Reconstructs the score from the current game snapshot when sound is enabled mid-game. */
export function rehydrationActions(
  snapshot: GameSnapshot,
  event: string
): readonly MusicalAction[] {
  const beat = roomBeat(snapshot.room.name) ?? 'room-andromeda';
  const hits = snapshot.variables.hits;
  return [
    ...roomActions(beat, snapshot),
    ...(inventoryCount(snapshot, 'carrier suit') > 0
      ? ([{ kind: 'play-track', track: 'hope', event }] as const)
      : []),
    ...(typeof hits === 'number' ? asteroidActions(hits, event) : [])
  ];
}
