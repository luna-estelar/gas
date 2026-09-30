import { describe, expect, it, test } from 'vitest';
import type { MusicalPosition } from '@luna-estelar/gas-protocol';
import {
  barToTime,
  comparePositions,
  createTempoSegmentMap,
  DEFAULT_TEMPO,
  DEFAULT_TIME_SIGNATURE,
  positionsEqual,
  positionToTime,
  reanchorTempo,
  resolveTiming,
  secondsPerBar,
  secondsPerBeat,
  TICKS_PER_BEAT,
  timeToBarFraction,
  timeToPosition
} from '../src/index.js';

function mapFor(tempo: number, beatsPerBar: number, beatUnit: number, startTime = 0) {
  return createTempoSegmentMap(
    resolveTiming({ tempo, timeSignature: { beatsPerBar, beatUnit } }),
    startTime
  );
}

describe('musical-time conversion', () => {
  it('uses renderer defaults only when authored timing is absent', () => {
    expect(resolveTiming(undefined)).toEqual({
      tempo: DEFAULT_TEMPO,
      timeSignature: DEFAULT_TIME_SIGNATURE
    });
    expect(
      resolveTiming(
        { tempo: 90, key: 'D minor' },
        { tempo: 80, timeSignature: { beatsPerBar: 3, beatUnit: 4 }, key: 'C' }
      )
    ).toEqual({
      tempo: 90,
      timeSignature: { beatsPerBar: 3, beatUnit: 4 },
      key: 'D minor'
    });
  });

  it('uses the specified beat and bar formulas', () => {
    expect(secondsPerBeat(120)).toBe(0.5);
    expect(secondsPerBar(120, 4)).toBe(2);
    expect(secondsPerBar(60, 3)).toBe(3);
  });

  it('maps bar one to the anchor and round-trips fractional bars', () => {
    const map = createTempoSegmentMap(resolveTiming(undefined), 10);
    expect(barToTime(map, 1)).toBe(10);
    expect(barToTime(map, 5)).toBe(18);
    for (const bar of [1, 1.5, 4, 9.25]) {
      expect(timeToBarFraction(map, barToTime(map, bar))).toBeCloseTo(bar, 10);
    }
  });

  it('carries the meter into the segment map so it describes its own beat', () => {
    expect(mapFor(120, 6, 8)[0]).toEqual({
      startBar: 1,
      tempo: 120,
      beatsPerBar: 6,
      beatUnit: 8,
      startTime: 0
    });
  });

  it('reanchors tempo without moving the anchor position', () => {
    const initial = createTempoSegmentMap(resolveTiming({ tempo: 120 }));
    const anchorTime = barToTime(initial, 5.5);
    const changed = reanchorTempo(initial, 5.5, 60, 4);
    expect(barToTime(changed, 5.5)).toBe(anchorTime);
    expect(barToTime(changed, 6.5)).toBe(anchorTime + 4);
    expect(timeToBarFraction(changed, anchorTime)).toBeCloseTo(5.5, 10);
  });

  it('keeps the meter in force across a tempo change unless told otherwise', () => {
    const initial = mapFor(120, 6, 8);
    expect(reanchorTempo(initial, 3, 60, 6).at(-1)?.beatUnit).toBe(8);
    expect(reanchorTempo(initial, 3, 60, 4, 4).at(-1)?.beatUnit).toBe(4);
  });
});

describe('musical position conversion', () => {
  // A beat is the meter's beatUnit note, so tempo alone fixes the beat length:
  // beat 3 lands one second into the bar at 120 BPM whether the meter counts
  // quarters or eighths. This is the definition the protocol README states.
  test.each([
    ['4/4', 4, 4],
    ['6/8', 6, 8]
  ])('places beat three one second in at 120 BPM in %s', (_name, beatsPerBar, beatUnit) => {
    const map = mapFor(120, beatsPerBar, beatUnit);
    expect(positionToTime(map, { bar: 1, beat: { index: 3 } })).toBe(1);
    expect(timeToPosition(map, 1)).toEqual({ bar: 1, beat: { index: 3 } });
  });

  it('reports a whole beat as an integer bar and beat, never a fractional bar', () => {
    const map = mapFor(120, 4, 4);
    // Two and a half bars in: what the old continuous conversion called bar 2.5.
    expect(timeToBarFraction(map, 3)).toBe(2.5);
    expect(timeToPosition(map, 3)).toEqual({ bar: 2, beat: { index: 3 } });
    expect(positionToTime(map, { bar: 2, beat: { index: 3 } })).toBe(3);
  });

  it('omits a beat at a bar start and an offset at a beat start', () => {
    const map = mapFor(120, 4, 4);
    expect(timeToPosition(map, 0)).toEqual({ bar: 1 });
    expect(timeToPosition(map, 2)).toEqual({ bar: 2 });
    expect(timeToPosition(map, 0.5)).toEqual({ bar: 1, beat: { index: 2 } });
  });

  test.each([
    ['4/4 at 120', 120, 4, 4],
    ['3/4 at 90', 90, 3, 4],
    ['6/8 at 120', 120, 6, 8]
  ])('round-trips every tick of a bar in %s', (_name, tempo, beatsPerBar, beatUnit) => {
    const map = mapFor(tempo, beatsPerBar, beatUnit, 7);
    for (let beat = 1; beat <= beatsPerBar; beat++) {
      for (const numerator of [0, 1, 240, 480, 959]) {
        const position: MusicalPosition =
          numerator === 0
            ? { bar: 3, beat: { index: beat } }
            : { bar: 3, beat: { index: beat, offset: { numerator, denominator: TICKS_PER_BEAT } } };
        const expected = beat === 1 && numerator === 0 ? { bar: 3 } : position;
        expect(timeToPosition(map, positionToTime(map, position))).toEqual(expected);
      }
    }
  });

  it('rounds to the nearest tick and carries into the next beat and bar', () => {
    const map = mapFor(120, 4, 4);
    // A hair under beat 2 rounds up to beat 2 rather than reporting 960/960.
    expect(timeToPosition(map, 0.5 - 0.0001)).toEqual({ bar: 1, beat: { index: 2 } });
    // A hair under bar 2 becomes bar 2, not a fifth beat of a four-beat bar.
    expect(timeToPosition(map, 2 - 0.0001)).toEqual({ bar: 2 });
  });

  it('clamps a time before the anchor to the first bar', () => {
    const map = mapFor(120, 4, 4, 10);
    expect(timeToPosition(map, 10)).toEqual({ bar: 1 });
    expect(timeToPosition(map, 0)).toEqual({ bar: 1 });
    expect(timeToPosition(map, -5)).toEqual({ bar: 1 });
  });

  it('follows a tempo change through the re-anchored segment', () => {
    const initial = mapFor(120, 4, 4);
    // Half way through bar 3, the tempo halves: bars then take four seconds.
    const changed = reanchorTempo(initial, 3.5, 60, 4);
    const anchor = barToTime(initial, 3.5);
    expect(timeToPosition(changed, anchor)).toEqual({ bar: 3, beat: { index: 3 } });
    expect(timeToPosition(changed, anchor + 4)).toEqual({ bar: 4, beat: { index: 3 } });
    expect(positionToTime(changed, { bar: 4, beat: { index: 3 } })).toBe(anchor + 4);
  });

  it('treats equal fractions with different denominators as one position', () => {
    const map = mapFor(120, 4, 4);
    const half: MusicalPosition = {
      bar: 1,
      beat: { index: 2, offset: { numerator: 1, denominator: 2 } }
    };
    const quarters: MusicalPosition = {
      bar: 1,
      beat: { index: 2, offset: { numerator: 2, denominator: 4 } }
    };
    expect(comparePositions(half, quarters)).toBe(0);
    expect(positionsEqual(half, quarters)).toBe(true);
    expect(positionToTime(map, half)).toBe(positionToTime(map, quarters));
    // Both reduce to the canonical tick denominator on the way back.
    expect(timeToPosition(map, positionToTime(map, half))).toEqual({
      bar: 1,
      beat: { index: 2, offset: { numerator: 480, denominator: TICKS_PER_BEAT } }
    });
  });

  it('rejects positions and times a tempo map cannot describe', () => {
    const map = mapFor(120, 4, 4);
    expect(() => positionToTime(map, { bar: 0 })).toThrow(/greater than zero/);
    expect(() => positionToTime(map, { bar: 1, beat: { index: 0 } })).toThrow(/greater than zero/);
    expect(() =>
      positionToTime(map, { bar: 1, beat: { index: 1, offset: { numerator: 1, denominator: 0 } } })
    ).toThrow(/greater than zero/);
    expect(() => timeToPosition(map, Number.NaN)).toThrow(/finite/);
    expect(() => timeToPosition([], 0)).toThrow(/at least one segment/);
  });
});
