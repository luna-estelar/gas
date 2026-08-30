// Musical-time calculations and timeline view models shared by browser controls.
import type { Diagnostic, CompiledTimeline } from './compile.js';

export const DEFAULT_TEMPO = 120;
export const DEFAULT_BEATS_PER_BAR = 4;
export const DEFAULT_BEAT_UNIT = 4;

export type DiagnosticCategory = Diagnostic['category'];
export type DiagnosticCounts = Record<DiagnosticCategory, number>;

export function countDiagnostics(diagnostics: readonly Diagnostic[]): DiagnosticCounts {
  const counts: DiagnosticCounts = { syntax: 0, semantic: 0, deferred: 0, informational: 0 };
  for (const diagnostic of diagnostics) counts[diagnostic.category]++;
  return counts;
}

export interface OffsetRange {
  readonly from: number;
  readonly to: number;
}

export function diagnosticOffsets(source: string, diagnostic: Diagnostic): OffsetRange {
  if (diagnostic.range === undefined) return { from: 0, to: Math.min(1, source.length) };
  const from = positionOffset(
    source,
    diagnostic.range.start.line,
    diagnostic.range.start.character
  );
  const to = positionOffset(source, diagnostic.range.end.line, diagnostic.range.end.character);
  return { from, to: Math.max(from, to) };
}

function positionOffset(source: string, requestedLine: number, requestedCharacter: number): number {
  const lines = source.split('\n');
  const line = Math.min(Math.max(0, requestedLine), Math.max(0, lines.length - 1));
  let offset = 0;
  for (let index = 0; index < line; index++) offset += (lines[index]?.length ?? 0) + 1;
  return Math.min(
    source.length,
    offset + Math.min(Math.max(0, requestedCharacter), lines[line]?.length ?? 0)
  );
}

export function tempoOf(timeline: CompiledTimeline): number {
  return timeline.musicalContext?.tempo ?? DEFAULT_TEMPO;
}

export function meterOf(timeline: CompiledTimeline): { beatsPerBar: number; beatUnit: number } {
  return (
    timeline.musicalContext?.timeSignature ?? {
      beatsPerBar: DEFAULT_BEATS_PER_BAR,
      beatUnit: DEFAULT_BEAT_UNIT
    }
  );
}

export function secondsPerBar(timeline: CompiledTimeline): number {
  return (meterOf(timeline).beatsPerBar * 60) / tempoOf(timeline);
}

export function positionSeconds(
  timeline: CompiledTimeline,
  position: CompiledTimeline['events'][number]['position']
): number {
  const meter = meterOf(timeline);
  const wholeBars = Math.max(0, position.bar - 1) * secondsPerBar(timeline);
  if (position.beat === undefined) return wholeBars;
  const offset =
    position.beat.offset === undefined
      ? 0
      : position.beat.offset.numerator / position.beat.offset.denominator;
  const beats = Math.max(0, position.beat.index - 1) + offset;
  return wholeBars + beats * (60 / tempoOf(timeline)) * (4 / meter.beatUnit);
}

export function totalBars(timeline: CompiledTimeline): number | null {
  return timeline.playback.mode === 'infinite' ? null : timeline.playback.declaredBars;
}

export function totalSeconds(timeline: CompiledTimeline): number | null {
  const bars = totalBars(timeline);
  return bars === null ? null : bars * secondsPerBar(timeline);
}

/** Move the transport clock by `delta`, wrapping a loop and clamping anything finite. */
export function advance(
  timeline: CompiledTimeline,
  seconds: number,
  delta: number,
  onComplete: () => void = () => undefined
): number {
  const next = Math.max(0, seconds + delta);
  const end = totalSeconds(timeline);
  if (end === null || end <= 0) return next;
  if (timeline.playback.mode === 'loop') return next % end;
  if (next >= end) {
    onComplete();
    return end;
  }
  return next;
}

// Convert elapsed time to the arranged timeline position. Loops wrap; other
// playback modes clamp to the arrangement end.
export function timelinePositionSeconds(
  seconds: number,
  arrangedBars: number,
  barDurationSeconds: number,
  mode: CompiledTimeline['playback']['mode']
): number {
  const span = arrangedBars * barDurationSeconds;
  const elapsed = Math.max(0, seconds);
  if (!Number.isFinite(span) || span <= 0) return elapsed;
  return mode === 'loop' ? elapsed % span : Math.min(elapsed, span);
}

export function timelineProgressPercent(
  seconds: number,
  arrangedBars: number,
  barDurationSeconds: number,
  mode: CompiledTimeline['playback']['mode']
): number {
  const span = arrangedBars * barDurationSeconds;
  if (!Number.isFinite(span) || span <= 0) return 0;
  return (timelinePositionSeconds(seconds, arrangedBars, barDurationSeconds, mode) / span) * 100;
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export interface SectionView {
  readonly id: string;
  readonly name: string;
  readonly startBar: number;
  readonly endBar: number;
  readonly width: number;
}

export interface EventView {
  readonly id: string;
  readonly bar: number;
  readonly seconds: number;
  readonly label: string;
  readonly detail: string;
  readonly sourceLine?: number;
}

export interface TimelineView {
  readonly sections: readonly SectionView[];
  readonly events: readonly EventView[];
  readonly meta: string;
}

export function deriveTimeline(timeline: CompiledTimeline): TimelineView {
  const span = Math.max(1, timeline.arrangedBars);
  const trackNames = new Map(timeline.tracks.map((track) => [track.trackId, track.name]));
  const sections = timeline.arrangement.map((section) => ({
    id: section.sectionInstanceId,
    name: section.sectionName,
    startBar: section.start.bar,
    endBar: section.end.bar,
    width: ((section.end.bar - section.start.bar) / span) * 100
  }));
  const authored: EventView[] = [...timeline.events]
    .sort((left, right) => left.position.bar - right.position.bar || left.sequence - right.sequence)
    .map((event) => ({
      id: event.eventId,
      bar: event.position.bar,
      seconds: positionSeconds(timeline, event.position),
      label:
        event.type === 'section'
          ? (timeline.arrangement.find((section) => section.sectionInstanceId === event.targetId)
              ?.sectionName ?? event.targetId)
          : (trackNames.get(event.targetId) ?? event.targetId),
      detail: eventDetail(event),
      sourceLine:
        event.provenance?.sourceRange === undefined
          ? undefined
          : event.provenance.sourceRange.start.line
    }));
  const boundaries: EventView[] = timeline.arrangement.flatMap((section) => [
    {
      id: `${section.sectionInstanceId}.start`,
      bar: section.start.bar,
      seconds: positionSeconds(timeline, section.start),
      label: section.sectionName,
      detail: 'section started',
      sourceLine: section.provenance?.sourceRange?.start.line
    },
    {
      id: `${section.sectionInstanceId}.end`,
      bar: section.end.bar,
      seconds: positionSeconds(timeline, section.end),
      label: section.sectionName,
      detail: 'section ended',
      sourceLine: section.provenance?.sourceRange?.start.line
    }
  ]);
  const events = [...boundaries, ...authored].sort(
    (left, right) => left.seconds - right.seconds || left.id.localeCompare(right.id)
  );
  const meter = meterOf(timeline);
  const bars = totalBars(timeline);
  const duration = totalSeconds(timeline);
  const meta = [
    `${tempoOf(timeline)} bpm`,
    timeline.musicalContext?.key,
    `${meter.beatsPerBar}/${meter.beatUnit}`,
    `${sections.length} ${sections.length === 1 ? 'section' : 'sections'}`,
    bars === null ? '∞ bars' : `${bars} bars`,
    duration === null ? 'unbounded' : `${Math.round(duration)} s`
  ]
    .filter(Boolean)
    .join(' · ');
  return { sections, events, meta };
}

function eventDetail(event: CompiledTimeline['events'][number]): string {
  if (!('value' in event)) return event.action;
  const value = event.value;
  switch (value.kind) {
    case 'text':
      return `${event.action} “${value.text}”`;
    case 'level':
      return `${event.action} ${value.value}`;
    case 'alda':
      return `${event.action} alda(…)`;
    case 'resource':
      return `${event.action} ${value.resourceId}`;
  }
}
