// The cascade: derive the complete effective state at a musical position from the
// session input state. Nothing position-dependent is ever stored — this is the
// derivation that keeps that promise. Five layers, later layers winning:
//
//   1. authored global defaults (globals, musicalContext)
//   2. authored track declarations and their defaults, in array order
//   3. staged overrides, in application order
//   4. authored timed and section events at or before the position, ordered by
//      position then sequence; section-scoped events count only while the active
//      section instance contains the position
//   5. live overrides, in application order
//
// Clears restore the layers below them: a staged clear resets its slot to the
// end-of-layer-2 checkpoint (the authored base), a live clear to the end-of-layer-4
// checkpoint (authored plus events). Within a layer, application order decides, so
// a later set beats an earlier clear and vice versa. Values are protocol
// `IntentValue`s; override payloads are wrapped here. No clock, no gain math: the
// Renderer/connector combine levels and act on tempo.

import type {
  ArrangementInstance,
  AldaValue,
  IntentValue,
  LevelValue,
  MusicalPosition,
  TextValue,
  TimeSignature,
  Timeline,
  TimelineEvent,
  TrackDefaultAction
} from '@luna-estelar/gas-protocol';
import type { InputState, Override } from './state.js';
import { comparePositions } from './positions.js';

export interface EffectiveGlobals {
  readonly flavor?: IntentValue;
  readonly level?: IntentValue;
  readonly tempo?: number;
  readonly key?: string;
  readonly timeSignature?: TimeSignature;
}

// One entry exists for every authored and host track, always — consumers never
// have to guess whether a track is simply absent. Value slots hold protocol
// intent values; `active` is derived from play/stop, never stored.
export interface EffectiveTrack {
  readonly trackId: string;
  readonly name: string;
  readonly description?: string;
  readonly active: boolean;
  readonly flavor?: IntentValue;
  readonly timbre?: IntentValue;
  readonly level?: IntentValue;
  readonly notes?: IntentValue;
  readonly motif?: IntentValue;
}

// Frozen effective-state snapshot at a musical position.
export interface EffectiveState {
  readonly globals: EffectiveGlobals;
  readonly tracks: readonly EffectiveTrack[];
}

// Renderer-derived position context. Section events require an active instance;
// loopIteration is reserved and currently does not affect state derivation.
export interface EffectiveStateOptions {
  readonly loopIteration?: number;
  readonly activeSection?: ArrangementInstance;
}

// The arrangement instance whose span contains the position, or undefined.
// Containment is `start.bar <= bar < end.bar`: arrangement `end` is exclusive,
// matching the compiler (an 8-bar section starting at bar 1 ends at `end.bar` 9).
export function sectionInstanceAt(
  timeline: Timeline,
  position: MusicalPosition
): ArrangementInstance | undefined {
  const bar = position.bar;
  return timeline.arrangement.find(
    (instance) => instance.start.bar <= bar && bar < instance.end.bar
  );
}

export function effectiveStateAt(
  state: InputState,
  position: MusicalPosition,
  options: EffectiveStateOptions = {}
): EffectiveState {
  const { timeline } = state;
  const { activeSection } = options;

  // Layer 1: authored global defaults and musical context.
  const globals: WorkingGlobals = {};
  if (timeline.globals.flavor !== undefined) globals.flavor = timeline.globals.flavor;
  if (timeline.globals.level !== undefined) globals.level = timeline.globals.level;
  if (timeline.musicalContext?.tempo !== undefined) globals.tempo = timeline.musicalContext.tempo;
  if (timeline.musicalContext?.key !== undefined) globals.key = timeline.musicalContext.key;
  if (timeline.musicalContext?.timeSignature !== undefined) {
    globals.timeSignature = timeline.musicalContext.timeSignature;
  }

  // Every authored track (array order) then every host track (array order). The
  // namespace is unique, so a host id never collides with an authored one.
  const tracks = new Map<string, WorkingTrack>();
  for (const track of timeline.tracks) {
    tracks.set(track.trackId, {
      trackId: track.trackId,
      name: track.name,
      description: track.description,
      active: false
    });
  }
  for (const host of state.hostTracks) {
    if (tracks.has(host.id)) continue;
    tracks.set(host.id, {
      trackId: host.id,
      name: host.name ?? host.id,
      description: host.description,
      active: false
    });
  }

  // Layer 2: authored track defaults, in declaration then default order.
  for (const track of timeline.tracks) {
    const working = tracks.get(track.trackId);
    if (working === undefined) continue;
    for (const def of track.defaults) {
      assignTrackSlot(working, def.action, def.value);
    }
  }

  // Authored base checkpoint (end of layer 2): a staged clear restores to here.
  const baseGlobals = snapshotGlobals(globals);
  const baseTracks = snapshotTracks(tracks);

  // Layer 3: staged overrides, in application order.
  for (const override of state.staged) {
    applyOverride(override, globals, tracks, baseGlobals, baseTracks);
  }

  // Layer 4: authored events at or before the position.
  for (const event of eventsUpTo(timeline.events, position, activeSection)) {
    applyEvent(event, globals, tracks);
  }

  // Authored-plus-events checkpoint (end of layer 4): a live clear restores here.
  const afterEventGlobals = snapshotGlobals(globals);
  const afterEventTracks = snapshotTracks(tracks);

  // Layer 5: live overrides, in application order.
  for (const override of state.live) {
    applyOverride(override, globals, tracks, afterEventGlobals, afterEventTracks);
  }

  return freezeEffectiveState(globals, tracks);
}

// --- Working state ------------------------------------------------------------

interface WorkingGlobals {
  flavor?: IntentValue;
  level?: IntentValue;
  tempo?: number;
  key?: string;
  timeSignature?: TimeSignature;
}

interface WorkingTrack {
  readonly trackId: string;
  name: string;
  description?: string;
  active: boolean;
  flavor?: IntentValue;
  timbre?: IntentValue;
  level?: IntentValue;
  notes?: IntentValue;
  motif?: IntentValue;
}

// Only the slots a clear can restore need checkpointing. `notes`/`motif` are
// set-only (no clear), and activity/key/timeSignature have no clear either.
interface GlobalCheckpoint {
  readonly flavor?: IntentValue;
  readonly level?: IntentValue;
  readonly tempo?: number;
}

type ClearableTrackSlot = 'flavor' | 'timbre' | 'level';
type TrackCheckpoint = Pick<WorkingTrack, ClearableTrackSlot>;

function snapshotGlobals(globals: WorkingGlobals): GlobalCheckpoint {
  return { flavor: globals.flavor, level: globals.level, tempo: globals.tempo };
}

function snapshotTracks(tracks: Map<string, WorkingTrack>): Map<string, TrackCheckpoint> {
  const snapshot = new Map<string, TrackCheckpoint>();
  for (const [id, track] of tracks) {
    snapshot.set(id, { flavor: track.flavor, timbre: track.timbre, level: track.level });
  }
  return snapshot;
}

// --- Layer application --------------------------------------------------------

// The events at or before the position, ordered by position then source
// sequence. A section-scoped event counts only while its instance is active;
// outside it the event is skipped and the slot falls back to the other layers.
function eventsUpTo(
  events: readonly TimelineEvent[],
  position: MusicalPosition,
  activeSection: ArrangementInstance | undefined
): TimelineEvent[] {
  return events
    .filter(
      (event) =>
        comparePositions(event.position, position) <= 0 && sectionActive(event, activeSection)
    )
    .sort((a, b) => comparePositions(a.position, b.position) || a.sequence - b.sequence);
}

function sectionActive(
  event: TimelineEvent,
  activeSection: ArrangementInstance | undefined
): boolean {
  if (event.scope !== 'section') {
    return true;
  }
  return activeSection !== undefined && event.sectionInstanceId === activeSection.sectionInstanceId;
}

function applyEvent(
  event: TimelineEvent,
  globals: WorkingGlobals,
  tracks: Map<string, WorkingTrack>
): void {
  if (event.type === 'section') {
    // Section flavor overlays the global flavor while its section instance is active.
    globals.flavor = event.value;
    return;
  }
  const working = tracks.get(event.targetId);
  if (working === undefined) {
    return; // validated timelines always resolve; defensive for foreign input
  }
  switch (event.action) {
    case 'play':
      working.active = true;
      return;
    case 'stop':
      working.active = false;
      return;
    default:
      assignTrackSlot(working, event.action, event.value);
  }
}

function applyOverride(
  override: Override,
  globals: WorkingGlobals,
  tracks: Map<string, WorkingTrack>,
  globalCheckpoint: GlobalCheckpoint,
  trackCheckpoints: Map<string, TrackCheckpoint>
): void {
  switch (override.kind) {
    case 'playTrack':
      setActive(tracks, override.trackId, true);
      return;
    case 'stopTrack':
      setActive(tracks, override.trackId, false);
      return;
    case 'setGlobalFlavor':
      globals.flavor = textValue(override.value);
      return;
    case 'clearGlobalFlavor':
      globals.flavor = globalCheckpoint.flavor;
      return;
    case 'setGlobalLevel':
      globals.level = levelValue(override.value);
      return;
    case 'clearGlobalLevel':
      globals.level = globalCheckpoint.level;
      return;
    case 'setTempo':
      globals.tempo = override.bpm;
      return;
    case 'clearTempo':
      globals.tempo = globalCheckpoint.tempo;
      return;
    case 'setTrackFlavor':
      setSlot(tracks, override.trackId, 'flavor', textValue(override.value));
      return;
    case 'clearTrackFlavor':
      restoreSlot(tracks, trackCheckpoints, override.trackId, 'flavor');
      return;
    case 'setTrackTimbre':
      setSlot(tracks, override.trackId, 'timbre', textValue(override.value));
      return;
    case 'clearTrackTimbre':
      restoreSlot(tracks, trackCheckpoints, override.trackId, 'timbre');
      return;
    case 'setTrackLevel':
      setSlot(tracks, override.trackId, 'level', levelValue(override.value));
      return;
    case 'clearTrackLevel':
      restoreSlot(tracks, trackCheckpoints, override.trackId, 'level');
      return;
    case 'setTrackNotes':
      setSlot(tracks, override.trackId, 'notes', aldaValue(override.alda));
      return;
    case 'setTrackMotif':
      setSlot(tracks, override.trackId, 'motif', aldaValue(override.alda));
      return;
  }
}

function assignTrackSlot(
  track: WorkingTrack,
  action: TrackDefaultAction,
  value: IntentValue
): void {
  switch (action) {
    case 'flavor':
      track.flavor = value;
      return;
    case 'timbre':
      track.timbre = value;
      return;
    case 'level':
      track.level = value;
      return;
    case 'notes':
      track.notes = value;
      return;
    case 'motif':
      track.motif = value;
      return;
  }
}

function setActive(tracks: Map<string, WorkingTrack>, trackId: string, active: boolean): void {
  const track = tracks.get(trackId);
  if (track !== undefined) {
    track.active = active;
  }
}

function setSlot(
  tracks: Map<string, WorkingTrack>,
  trackId: string,
  slot: 'flavor' | 'timbre' | 'level' | 'notes' | 'motif',
  value: IntentValue
): void {
  const track = tracks.get(trackId);
  if (track !== undefined) {
    track[slot] = value;
  }
}

function restoreSlot(
  tracks: Map<string, WorkingTrack>,
  checkpoints: Map<string, TrackCheckpoint>,
  trackId: string,
  slot: ClearableTrackSlot
): void {
  const track = tracks.get(trackId);
  if (track === undefined) {
    return;
  }
  track[slot] = checkpoints.get(trackId)?.[slot];
}

// Override payloads are wrapped into protocol intent values at derivation time,
// frozen because Core owns them (authored values are referenced as-is).
function textValue(text: string): TextValue {
  return Object.freeze({ kind: 'text', text });
}

function levelValue(value: number): LevelValue {
  return Object.freeze({ kind: 'level', value });
}

function aldaValue(source: string): AldaValue {
  return Object.freeze({ kind: 'alda', source });
}

// --- Output -------------------------------------------------------------------

function freezeEffectiveState(
  globals: WorkingGlobals,
  tracks: Map<string, WorkingTrack>
): EffectiveState {
  const frozenTracks = [...tracks.values()].map((track) => Object.freeze(pruneTrack(track)));
  return Object.freeze({
    globals: Object.freeze(pruneGlobals(globals)),
    tracks: Object.freeze(frozenTracks)
  });
}

function pruneGlobals(globals: WorkingGlobals): EffectiveGlobals {
  return {
    ...(globals.flavor !== undefined ? { flavor: globals.flavor } : {}),
    ...(globals.level !== undefined ? { level: globals.level } : {}),
    ...(globals.tempo !== undefined ? { tempo: globals.tempo } : {}),
    ...(globals.key !== undefined ? { key: globals.key } : {}),
    ...(globals.timeSignature !== undefined ? { timeSignature: globals.timeSignature } : {})
  };
}

function pruneTrack(track: WorkingTrack): EffectiveTrack {
  return {
    trackId: track.trackId,
    name: track.name,
    active: track.active,
    ...(track.description !== undefined ? { description: track.description } : {}),
    ...(track.flavor !== undefined ? { flavor: track.flavor } : {}),
    ...(track.timbre !== undefined ? { timbre: track.timbre } : {}),
    ...(track.level !== undefined ? { level: track.level } : {}),
    ...(track.notes !== undefined ? { notes: track.notes } : {}),
    ...(track.motif !== undefined ? { motif: track.motif } : {})
  };
}
