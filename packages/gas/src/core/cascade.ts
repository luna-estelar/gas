// The cascade: derive the complete effective state at a musical position from the
// session input state. Nothing position-dependent is ever stored — this is the
// derivation that keeps that promise. Four layers, later layers winning:
//
//   1. authored global defaults (globals, musicalContext)
//   2. authored track declarations and their defaults, in array order
//   3. authored timed and section events at or before the position, ordered by
//      position then sequence; section-scoped events count only while the active
//      section instance contains the position
//   4. app values, in list order
//
// App values sit above the score however and whenever they were set. A clear
// removes its slot's app value, so nothing in layer 4 covers that slot and the
// score's value at the position shows through. Values are protocol
// `IntentValue`s; app value payloads are wrapped here. No clock, no gain math: the
// Renderer/connector combine levels and act on tempo.

import type {
  ArrangementInstance,
  AldaValue,
  EffectiveGlobals,
  EffectiveState,
  EffectiveTrack,
  IntentValue,
  LevelValue,
  MusicalPosition,
  TextValue,
  TimeSignature,
  Timeline,
  TimelineEvent,
  TrackDefaultAction
} from '../protocol/index.js';
import type { InputState, Override } from './state.js';
import { comparePositions } from './positions.js';

export type { EffectiveGlobals, EffectiveState, EffectiveTrack } from '../protocol/index.js';

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

  // Every authored track (array order) then every app track (array order). The
  // namespace is unique, so an app id never collides with an authored one.
  const tracks = new Map<string, WorkingTrack>();
  for (const track of timeline.tracks) {
    tracks.set(track.trackId, {
      trackId: track.trackId,
      name: track.name,
      description: track.description,
      active: false
    });
  }
  for (const app of state.appTracks) {
    if (tracks.has(app.id)) continue;
    tracks.set(app.id, {
      trackId: app.id,
      name: app.name ?? app.id,
      description: app.description,
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

  // Layer 3: authored events at or before the position.
  for (const event of eventsUpTo(timeline.events, position, activeSection)) {
    applyEvent(event, globals, tracks);
  }

  // Layer 4: app values, in list order.
  for (const value of state.appValues) {
    applyAppValue(value, globals, tracks);
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

function applyAppValue(
  override: Override,
  globals: WorkingGlobals,
  tracks: Map<string, WorkingTrack>
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
    case 'setGlobalLevel':
      globals.level = levelValue(override.value);
      return;
    case 'setTempo':
      globals.tempo = override.bpm;
      return;
    case 'setTrackFlavor':
      setSlot(tracks, override.trackId, 'flavor', textValue(override.value));
      return;
    case 'setTrackTimbre':
      setSlot(tracks, override.trackId, 'timbre', textValue(override.value));
      return;
    case 'setTrackLevel':
      setSlot(tracks, override.trackId, 'level', levelValue(override.value));
      return;
    case 'setTrackNotes':
      setSlot(tracks, override.trackId, 'notes', aldaValue(override.alda));
      return;
    case 'setTrackMotif':
      setSlot(tracks, override.trackId, 'motif', aldaValue(override.alda));
      return;
    // Clears are never stored in app values; see `applyCommand`.
    case 'clearGlobalFlavor':
    case 'clearGlobalLevel':
    case 'clearTempo':
    case 'clearTrackPlay':
    case 'clearTrackFlavor':
    case 'clearTrackTimbre':
    case 'clearTrackLevel':
    case 'clearTrackNotes':
    case 'clearTrackMotif':
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

// App value payloads are wrapped into protocol intent values at derivation time,
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
