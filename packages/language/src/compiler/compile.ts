// Compile semantic documents into deterministic timelines in absolute musical time.
// The renderer converts musical positions to elapsed time.

import {
  effectiveLengthBars,
  resolveSection,
  type FlavorGlobal,
  type GasDocument,
  type GasSourceRange,
  type Globals,
  type GlobalLength,
  type Section,
  type TrackCommand
} from '../semantic/ast.js';
import { semanticDiagnostic, type GasDiagnostic } from '../semantic/diagnostics.js';
import { allocateId, eventId, slugify } from './ids.js';
import type {
  ArrangementInstance,
  GlobalDefaults,
  IntentValue,
  LevelValue,
  MusicalContext,
  Playback,
  Provenance,
  SourceIdentity,
  SourceRange,
  TextValue,
  Timeline,
  TimelineEvent,
  TimeSignature,
  TrackDeclaration,
  TrackDefault,
  ValuedTrackAction
} from '@luna-estelar/gas-protocol';

const FORMAT_VERSION = { major: 1, minor: 0 } as const;
// The GAS language spec version this compiler targets, and the compiler's own
// version. COMPILER_VERSION mirrors the language package's `version`.
const LANGUAGE_VERSION = '1.0';
const COMPILER_VERSION = '0.1.0';
const SOURCE_MEDIA_TYPE = 'text/vnd.gas';
const DEFAULT_TIMELINE_ID = 'timeline';

// Same-bar ordering: section-scoped events (section flavor + section-level
// setup commands) sit at the top of the section, before bar-block events.
const RANK_SECTION = 0;
const RANK_BAR = 1;

export interface CompileOptions {
  readonly name?: string;
  readonly timelineId?: string;
}

export interface CompileResult {
  readonly timeline?: Timeline;
  readonly diagnostics: readonly GasDiagnostic[];
}

type ValuedCommand = Extract<
  TrackCommand,
  { kind: 'Flavor' | 'Timbre' | 'Level' | 'Notes' | 'Motif' }
>;

// An event whose identity (eventId, sequence) is assigned only after the global
// position-then-source-order sort.
interface PendingEvent {
  readonly bar: number;
  readonly rank: number;
  readonly sourceOrder: number;
  readonly build: (id: string, sequence: number) => TimelineEvent;
}

interface SectionContext {
  readonly startBar: number;
  readonly callIndex: number;
  readonly sectionInstanceId: string;
  readonly sectionName: string;
  readonly trackIdByName: ReadonlyMap<string, string>;
}

export function compileDocument(
  document: GasDocument,
  source: string,
  options: CompileOptions = {}
): CompileResult {
  const diagnostics: GasDiagnostic[] = [];

  const length = document.globals.length;
  if (length === undefined) {
    // Unreachable on success: `missing-length` is an error caught upstream.
    return { diagnostics };
  }

  const trackIdByName = new Map<string, string>();
  const tracks = buildTracks(document, trackIdByName);

  const arrangement: ArrangementInstance[] = [];
  const pending: PendingEvent[] = [];
  let cursor = 1;

  document.arrangement.forEach((call, callIndex) => {
    const section = resolveSection(document, call);
    if (section === undefined) {
      // Unreachable on success: `unresolved-section` is an error from build.
      return;
    }

    const lengthBars = effectiveLengthBars(section, document.globals);
    if (lengthBars === undefined) {
      diagnostics.push(
        semanticDiagnostic(
          'missing-section-length',
          'error',
          `Section '${section.name}' needs a length; add 'length bars N' to the section, or use a finite global length.`,
          call.range
        )
      );
      return;
    }

    const startBar = cursor;
    const endBar = cursor + lengthBars;
    const sectionInstanceId = `section.${slugify(section.name)}.${callIndex}`;

    arrangement.push({
      sectionInstanceId,
      sectionName: section.name,
      callIndex,
      start: { bar: startBar },
      end: { bar: endBar },
      provenance: { sourceRange: cloneRange(call.range) }
    });

    collectSectionEvents(
      section,
      { startBar, callIndex, sectionInstanceId, sectionName: section.name, trackIdByName },
      pending
    );

    cursor = endBar;
  });

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { diagnostics };
  }

  const musicalContext = buildMusicalContext(document.globals);
  const timeline: Timeline = {
    formatVersion: FORMAT_VERSION,
    timelineId: options.timelineId ?? DEFAULT_TIMELINE_ID,
    languageVersion: LANGUAGE_VERSION,
    compilerVersion: COMPILER_VERSION,
    source: buildSourceIdentity(source, options.name),
    playback: toPlayback(length),
    arrangedBars: cursor - 1,
    ...(musicalContext !== undefined ? { musicalContext } : {}),
    globals: buildGlobalDefaults(document.globals),
    tracks,
    arrangement,
    resources: [],
    events: finalizeEvents(pending)
  };

  return { timeline, diagnostics };
}

function buildTracks(
  document: GasDocument,
  trackIdByName: Map<string, string>
): TrackDeclaration[] {
  const usedTrackIds = new Set<string>();
  const declarations: TrackDeclaration[] = [];

  for (const track of document.tracks) {
    const slug = slugify(track.name);
    const trackId = allocateId(`track.${slug}`, usedTrackIds);
    if (!trackIdByName.has(track.name)) {
      trackIdByName.set(track.name, trackId);
    }

    const usedDefaultIds = new Set<string>();
    const defaults: TrackDefault[] = [];
    for (const command of track.defaults) {
      const trackDefault = toTrackDefault(command, slug, usedDefaultIds);
      if (trackDefault !== undefined) {
        defaults.push(trackDefault);
      }
    }

    declarations.push({
      trackId,
      name: track.name,
      description: track.description,
      defaults,
      provenance: { sourceRange: cloneRange(track.range) }
    });
  }

  return declarations;
}

function toTrackDefault(
  command: TrackCommand,
  trackSlug: string,
  usedIds: Set<string>
): TrackDefault | undefined {
  if (command.kind === 'Play' || command.kind === 'Stop') {
    // Unreachable on success: `play-stop-not-timed` is an error for top-level
    // play/stop, so a track default is always a valued command.
    return undefined;
  }
  const action = valuedAction(command);
  return {
    defaultId: allocateId(`default.${trackSlug}.${action}`, usedIds),
    action,
    value: toIntentValue(command),
    provenance: { sourceRange: cloneRange(command.range) }
  };
}

function collectSectionEvents(section: Section, ctx: SectionContext, out: PendingEvent[]): void {
  // Section-wide flavor: the first one wins (later ones are `duplicate-section-
  // flavor` warnings). Applies for the whole section instance.
  const flavor = section.flavors[0];
  if (flavor !== undefined) {
    out.push(sectionFlavorPending(flavor, ctx));
  }

  // Section-level commands (before the first bar): valued commands are
  // section-scoped for the whole instance; play/stop are bar-1 shorthand.
  for (const command of section.setup) {
    pushCommandEvent(
      command,
      ctx,
      { bar: ctx.startBar, sectionBar: 1, rank: RANK_SECTION, valuedScope: 'section' },
      out
    );
  }

  // Bar-block commands: timed events at the absolute bar.
  for (const bar of section.bars) {
    const absoluteBar = ctx.startBar + bar.number - 1;
    for (const command of bar.commands) {
      pushCommandEvent(
        command,
        ctx,
        { bar: absoluteBar, sectionBar: bar.number, rank: RANK_BAR, valuedScope: 'timed' },
        out
      );
    }
  }
}

interface Placement {
  readonly bar: number;
  readonly sectionBar: number;
  readonly rank: number;
  readonly valuedScope: 'timed' | 'section';
}

function sectionFlavorPending(flavor: FlavorGlobal, ctx: SectionContext): PendingEvent {
  const value: TextValue = { kind: 'text', text: flavor.value };
  const provenance = sectionProvenance(flavor.range, ctx, 1);
  return {
    bar: ctx.startBar,
    rank: RANK_SECTION,
    sourceOrder: flavor.sourceOrder,
    build: (id, sequence) => ({
      eventId: id,
      type: 'section',
      targetId: ctx.sectionInstanceId,
      action: 'flavor',
      position: { bar: ctx.startBar },
      sequence,
      scope: 'section',
      sectionInstanceId: ctx.sectionInstanceId,
      value,
      provenance
    })
  };
}

function pushCommandEvent(
  command: TrackCommand,
  ctx: SectionContext,
  place: Placement,
  out: PendingEvent[]
): void {
  const targetId = ctx.trackIdByName.get(command.trackName);
  if (targetId === undefined) {
    // Unreachable on success: `unresolved-track` is an error from build.
    return;
  }
  const provenance = sectionProvenance(command.range, ctx, place.sectionBar);

  if (command.kind === 'Play' || command.kind === 'Stop') {
    const action = command.kind === 'Play' ? 'play' : 'stop';
    out.push({
      bar: place.bar,
      rank: place.rank,
      sourceOrder: command.sourceOrder,
      build: (id, sequence) => ({
        eventId: id,
        type: 'track',
        targetId,
        action,
        position: { bar: place.bar },
        sequence,
        scope: 'timed',
        sectionInstanceId: ctx.sectionInstanceId,
        provenance
      })
    });
    return;
  }

  const action = valuedAction(command);
  const value = toIntentValue(command);
  const scope = place.valuedScope;
  out.push({
    bar: place.bar,
    rank: place.rank,
    sourceOrder: command.sourceOrder,
    build: (id, sequence) => ({
      eventId: id,
      type: 'track',
      targetId,
      action,
      position: { bar: place.bar },
      sequence,
      scope,
      sectionInstanceId: ctx.sectionInstanceId,
      value,
      provenance
    })
  });
}

function finalizeEvents(pending: readonly PendingEvent[]): TimelineEvent[] {
  const sorted = [...pending].sort(
    (a, b) => a.bar - b.bar || a.rank - b.rank || a.sourceOrder - b.sourceOrder
  );
  return sorted.map((event, index) => event.build(eventId(index), index));
}

function toIntentValue(command: ValuedCommand): IntentValue {
  switch (command.kind) {
    case 'Flavor':
      return { kind: 'text', text: command.value };
    case 'Timbre':
      return { kind: 'text', text: command.value.value };
    case 'Level':
      return { kind: 'level', value: command.value };
    case 'Notes':
    case 'Motif':
      return { kind: 'alda', source: command.value.raw };
  }
}

function valuedAction(command: ValuedCommand): ValuedTrackAction {
  switch (command.kind) {
    case 'Flavor':
      return 'flavor';
    case 'Timbre':
      return 'timbre';
    case 'Level':
      return 'level';
    case 'Notes':
      return 'notes';
    case 'Motif':
      return 'motif';
  }
}

function toPlayback(length: GlobalLength): Playback {
  if (length.mode === 'infinite') {
    return { mode: 'infinite' };
  }
  // Bars are present and >= 1 on success (grammar + `invalid-length`).
  const declaredBars = length.bars ?? 1;
  return length.mode === 'loop' ? { mode: 'loop', declaredBars } : { mode: 'finite', declaredBars };
}

function buildMusicalContext(globals: Globals): MusicalContext | undefined {
  const context: { tempo?: number; timeSignature?: TimeSignature; key?: string } = {};
  let authored = false;
  if (globals.tempo !== undefined) {
    context.tempo = globals.tempo.bpm;
    authored = true;
  }
  if (globals.timeSignature !== undefined) {
    context.timeSignature = {
      beatsPerBar: globals.timeSignature.numerator,
      beatUnit: globals.timeSignature.denominator
    };
    authored = true;
  }
  if (globals.key !== undefined) {
    context.key = globals.key.value;
    authored = true;
  }
  return authored ? context : undefined;
}

function buildGlobalDefaults(globals: Globals): GlobalDefaults {
  const defaults: { flavor?: TextValue; level?: LevelValue } = {};
  if (globals.flavor !== undefined) {
    defaults.flavor = { kind: 'text', text: globals.flavor.value };
  }
  if (globals.level !== undefined) {
    defaults.level = { kind: 'level', value: globals.level.value };
  }
  return defaults;
}

function buildSourceIdentity(source: string, name: string | undefined): SourceIdentity {
  const identity: { name?: string; mediaType?: string; byteLength?: number } = {
    mediaType: SOURCE_MEDIA_TYPE,
    byteLength: new TextEncoder().encode(source).length
  };
  if (name !== undefined) {
    identity.name = name;
  }
  return identity;
}

function sectionProvenance(
  range: GasSourceRange,
  ctx: SectionContext,
  sectionBar: number
): Provenance {
  return {
    sourceRange: cloneRange(range),
    sectionName: ctx.sectionName,
    sectionInstanceId: ctx.sectionInstanceId,
    callIndex: ctx.callIndex,
    sectionPosition: { bar: sectionBar }
  };
}

// Copy the semantic source range into a plain timeline range. Structurally
// identical, but detaches the timeline from semantic-node object identity.
function cloneRange(range: GasSourceRange): SourceRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character }
  };
}
