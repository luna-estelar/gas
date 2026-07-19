import type { MusicalContext, RendererDefaults, TimeSignature } from '@luna-estelar/gas-protocol';

export const DEFAULT_TEMPO = 120;
export const DEFAULT_TIME_SIGNATURE: TimeSignature = Object.freeze({
  beatsPerBar: 4,
  beatUnit: 4
});

export interface ResolvedTiming {
  readonly tempo: number;
  readonly timeSignature: TimeSignature;
  readonly key?: string;
}

export interface TempoSegment {
  readonly startBar: number;
  readonly tempo: number;
  readonly beatsPerBar: number;
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
      startTime
    })
  ]);
}

export function reanchorTempo(
  segments: TempoSegmentMap,
  startBar: number,
  tempo: number,
  beatsPerBar: number
): TempoSegmentMap {
  assertSegments(segments);
  assertPositive('startBar', startBar);
  assertPositive('tempo', tempo);
  assertPositive('beatsPerBar', beatsPerBar);
  const startTime = barToTime(segments, startBar);
  const retained = segments.filter((segment) => segment.startBar < startBar);
  return Object.freeze([...retained, Object.freeze({ startBar, tempo, beatsPerBar, startTime })]);
}

export function barToTime(segments: TempoSegmentMap, bar: number): number {
  assertSegments(segments);
  assertPositive('bar', bar);
  const segment = segmentForBar(segments, bar);
  return (
    segment.startTime + (bar - segment.startBar) * secondsPerBar(segment.tempo, segment.beatsPerBar)
  );
}

export function timeToBar(segments: TempoSegmentMap, time: number): number {
  assertSegments(segments);
  assertFinite('time', time);
  const segment = segmentForTime(segments, time);
  return (
    segment.startBar +
    (time - segment.startTime) / secondsPerBar(segment.tempo, segment.beatsPerBar)
  );
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
