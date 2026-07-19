import { describe, expect, it, vi } from 'vitest';
import {
  barToTime,
  createTempoSegmentMap,
  DEFAULT_TEMPO,
  DEFAULT_TIME_SIGNATURE,
  reanchorTempo,
  resolveTiming,
  secondsPerBar,
  secondsPerBeat,
  timeToBar
} from '../src/index.js';
import { VirtualClock } from './support/virtual-clock.js';

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
      expect(timeToBar(map, barToTime(map, bar))).toBeCloseTo(bar, 10);
    }
  });

  it('reanchors tempo without moving the anchor position', () => {
    const initial = createTempoSegmentMap(resolveTiming({ tempo: 120 }));
    const anchorTime = barToTime(initial, 5.5);
    const changed = reanchorTempo(initial, 5.5, 60, 4);
    expect(barToTime(changed, 5.5)).toBe(anchorTime);
    expect(barToTime(changed, 6.5)).toBe(anchorTime + 4);
    expect(timeToBar(changed, anchorTime)).toBeCloseTo(5.5, 10);
  });
});

describe('virtual monotonic clock', () => {
  it('fires equal deadlines in insertion order and exposes pending work', () => {
    const clock = new VirtualClock();
    const fired: string[] = [];
    clock.schedule(2, () => fired.push('a'));
    clock.schedule(1, () => fired.push('first'));
    clock.schedule(2, () => fired.push('b'));
    expect(clock.pendingDeadlines()).toEqual([1, 2, 2]);
    clock.advanceTo(2);
    expect(fired).toEqual(['first', 'a', 'b']);
    expect(clock.pendingDeadlines()).toEqual([]);
  });

  it('cancels callbacks and rejects backwards movement', () => {
    const clock = new VirtualClock();
    const callback = vi.fn();
    const timer = clock.schedule(1, callback);
    clock.cancel(timer);
    clock.advanceBy(2);
    expect(callback).not.toHaveBeenCalled();
    expect(() => clock.advanceTo(1)).toThrow(/backwards/);
  });
});
