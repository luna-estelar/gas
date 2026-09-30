// The one conversion between musical position and clock seconds. It lives in
// Core because both the Renderer (scheduling) and a browser host (placing the
// audible playhead) need it, and a host must not depend on the Renderer to get
// it.
//
// Tempo is beats per minute where a beat is the meter's `beatUnit` note. So
// `secondsPerBeat = 60 / tempo` and `secondsPerBar = beatsPerBar x 60 / tempo`,
// with no `4 / beatUnit` factor anywhere: an event on beat 3 lands 1.0 s into
// the bar at 120 BPM in 6/8 exactly as it does in 4/4, because in 6/8 a beat is
// an eighth note. `beatUnit` therefore says what a beat *is* without entering
// the arithmetic.

import type {
  BeatOffset,
  MusicalContext,
  MusicalPosition,
  RendererDefaults,
  TimeSignature
} from '@luna-estelar/gas-protocol';

export const DEFAULT_TEMPO = 120;
export const DEFAULT_TIME_SIGNATURE: TimeSignature = Object.freeze({
  beatsPerBar: 4,
  beatUnit: 4
});

/**
 * The fixed denominator every derived beat offset is reduced to: 960 ticks per
 * beat, the standard PPQ-style resolution. A derived position is therefore
 * exact, comparable and JSON-safe, and rounding to whole ticks is what makes
 * the carry in {@link timeToPosition} fall out of integer arithmetic.
 */
export const TICKS_PER_BEAT = 960;

export interface ResolvedTiming {
  readonly tempo: number;
  readonly timeSignature: TimeSignature;
  readonly key?: string;
}

export interface TempoSegment {
  readonly startBar: number;
  readonly tempo: number;
  readonly beatsPerBar: number;
  readonly beatUnit: number;
  readonly startTime: number;
}

export type TempoSegmentMap = readonly TempoSegment[];

export function resolveTiming(
  authored: MusicalContext | undefined,
  defaults: RendererDefaults = {}
): ResolvedTiming {
  const tempo = authored?.tempo ?? defaults.tempo ?? DEFAULT_TEMPO;
  const timeSignature = authored?.timeSignature ?? defaults.timeSignature ?? DEFAULT_TIME_SIGNATURE;
  assertPositive('tempo', tempo);
  assertPositive('beatsPerBar', timeSignature.beatsPerBar);
  assertPositive('beatUnit', timeSignature.beatUnit);
  const key = authored?.key ?? defaults.key;
  return Object.freeze({
    tempo,
    timeSignature: Object.freeze({ ...timeSignature }),
    ...(key !== undefined ? { key } : {})
  });
}

export function secondsPerBeat(tempo: number): number {
  assertPositive('tempo', tempo);
  return 60 / tempo;
}

export function secondsPerBar(tempo: number, beatsPerBar: number): number {
  assertPositive('beatsPerBar', beatsPerBar);
  return secondsPerBeat(tempo) * beatsPerBar;
}

export function createTempoSegmentMap(
  timing: ResolvedTiming,
  startTime = 0,
  startBar = 1
): TempoSegmentMap {
  assertFinite('startTime', startTime);
  assertPositive('startBar', startBar);
  return Object.freeze([
    Object.freeze({
      startBar,
      tempo: timing.tempo,
      beatsPerBar: timing.timeSignature.beatsPerBar,
      beatUnit: timing.timeSignature.beatUnit,
      startTime
    })
  ]);
}

/**
 * Starts a new tempo segment at `startBar` without moving that bar in time, so
 * a live tempo change is inaudible as a jump. `beatUnit` defaults to the meter
 * already in force at `startBar`: Protocol 1.0 declares the meter once per
 * document, so a tempo change does not restate it.
 *
 * `startBar` may be fractional, which is how a change mid-bar anchors exactly at
 * the current instant; pass `timeToBarFraction(segments, now)`, never a rounded
 * bar, or the new segment's origin lands in the past.
 */
export function reanchorTempo(
  segments: TempoSegmentMap,
  startBar: number,
  tempo: number,
  beatsPerBar: number,
  beatUnit?: number
): TempoSegmentMap {
  assertSegments(segments);
  assertPositive('startBar', startBar);
  assertPositive('tempo', tempo);
  assertPositive('beatsPerBar', beatsPerBar);
  const startTime = barToTime(segments, startBar);
  const resolvedBeatUnit = beatUnit ?? segmentForBar(segments, startBar).beatUnit;
  assertPositive('beatUnit', resolvedBeatUnit);
  const retained = segments.filter((segment) => segment.startBar < startBar);
  return Object.freeze([
    ...retained,
    Object.freeze({ startBar, tempo, beatsPerBar, beatUnit: resolvedBeatUnit, startTime })
  ]);
}

export function barToTime(segments: TempoSegmentMap, bar: number): number {
  assertSegments(segments);
  assertPositive('bar', bar);
  const segment = segmentForBar(segments, bar);
  return (
    segment.startTime + (bar - segment.startBar) * secondsPerBar(segment.tempo, segment.beatsPerBar)
  );
}

/**
 * The continuous bar coordinate at `time`: bar 2.5 is halfway through bar 2.
 * This is not a {@link MusicalPosition} — protocol bars are integers — so it is
 * for callers doing bar arithmetic, above all re-anchoring a tempo change at the
 * exact current instant. Use {@link timeToPosition} for anything a host sees.
 */
export function timeToBarFraction(segments: TempoSegmentMap, time: number): number {
  assertSegments(segments);
  assertFinite('time', time);
  const segment = segmentForTime(segments, time);
  return (
    segment.startBar +
    (time - segment.startTime) / secondsPerBar(segment.tempo, segment.beatsPerBar)
  );
}

/**
 * The clock time of a musical position, beats included. An absent `beat` is the
 * start of the bar and an absent `offset` the start of the beat, matching how
 * `comparePositions` orders them.
 */
export function positionToTime(segments: TempoSegmentMap, position: MusicalPosition): number {
  assertSegments(segments);
  assertPositive('position.bar', position.bar);
  const barStart = barToTime(segments, position.bar);
  if (position.beat === undefined) return barStart;
  assertPositive('position.beat.index', position.beat.index);
  const segment = segmentForBar(segments, position.bar);
  const beats = position.beat.index - 1 + offsetFraction(position.beat.offset);
  return barStart + beats * secondsPerBeat(segment.tempo);
}

/**
 * The musical position at `time`, always a legal protocol position: an integer
 * bar of at least 1, and a beat whose offset is whole ticks over
 * {@link TICKS_PER_BEAT}. Rounding to whole ticks before splitting into bar and
 * beat is what carries a near-miss forward — a value a hair under the next beat
 * becomes that beat at offset 0, and one a hair under the next bar becomes bar
 * + 1 beat 1 — so no position is ever reported past the end of its own bar.
 *
 * Redundant members are omitted, so a bar start is `{ bar: 2 }` and never also
 * `{ bar: 2, beat: { index: 1, offset: { numerator: 0, denominator: 960 } } }`.
 */
export function timeToPosition(segments: TempoSegmentMap, time: number): MusicalPosition {
  assertSegments(segments);
  assertFinite('time', time);
  const segment = segmentForTime(segments, time);
  const ticksPerBar = TICKS_PER_BEAT * segment.beatsPerBar;
  // Counted from bar 1 rather than from the segment, because a segment that was
  // re-anchored mid-bar has a fractional `startBar` and adding to that would
  // hand back a fractional bar — the very thing this function exists to avoid.
  const ticksElapsed =
    Math.round((segment.startBar - 1) * ticksPerBar) +
    Math.round(((time - segment.startTime) / secondsPerBeat(segment.tempo)) * TICKS_PER_BEAT);
  const barsElapsed = Math.floor(ticksElapsed / ticksPerBar);
  const bar = 1 + barsElapsed;
  // A time before the map's first segment has no musical position; the piece
  // starts at bar 1.
  if (bar < 1) return Object.freeze({ bar: 1 });
  const withinBar = ticksElapsed - barsElapsed * ticksPerBar;
  const index = Math.floor(withinBar / TICKS_PER_BEAT) + 1;
  const numerator = withinBar - (index - 1) * TICKS_PER_BEAT;
  if (numerator === 0) {
    return index === 1
      ? Object.freeze({ bar })
      : Object.freeze({ bar, beat: Object.freeze({ index }) });
  }
  return Object.freeze({
    bar,
    beat: Object.freeze({
      index,
      offset: Object.freeze({ numerator, denominator: TICKS_PER_BEAT })
    })
  });
}

function offsetFraction(offset: BeatOffset | undefined): number {
  if (offset === undefined) return 0;
  assertFinite('offset.numerator', offset.numerator);
  assertPositive('offset.denominator', offset.denominator);
  return offset.numerator / offset.denominator;
}

function segmentForBar(segments: TempoSegmentMap, bar: number): TempoSegment {
  let selected = segments[0]!;
  for (const segment of segments) {
    if (segment.startBar > bar) break;
    selected = segment;
  }
  return selected;
}

function segmentForTime(segments: TempoSegmentMap, time: number): TempoSegment {
  let selected = segments[0]!;
  for (const segment of segments) {
    if (segment.startTime > time) break;
    selected = segment;
  }
  return selected;
}

function assertSegments(segments: TempoSegmentMap): void {
  if (segments.length === 0) throw new RangeError('A tempo map needs at least one segment.');
  let previousBar = -Infinity;
  let previousTime = -Infinity;
  for (const segment of segments) {
    assertPositive('segment.startBar', segment.startBar);
    assertPositive('segment.tempo', segment.tempo);
    assertPositive('segment.beatsPerBar', segment.beatsPerBar);
    assertPositive('segment.beatUnit', segment.beatUnit);
    assertFinite('segment.startTime', segment.startTime);
    if (segment.startBar <= previousBar || segment.startTime < previousTime) {
      throw new RangeError('Tempo segments must be ordered by bar and monotonic time.');
    }
    previousBar = segment.startBar;
    previousTime = segment.startTime;
  }
}

function assertPositive(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be greater than zero.`);
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}
