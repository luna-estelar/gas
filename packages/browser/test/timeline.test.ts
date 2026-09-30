// Timeline calculations with synthetic inputs. Root corpus tests cover compiled GAS documents.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/compile.js';
import { testTimeline } from './support/timeline.js';
import {
  countDiagnostics,
  diagnosticOffsets,
  formatClock,
  positionSeconds,
  timelinePositionSeconds,
  timelineProgressPercent
} from '../src/timeline.js';

describe('diagnostics', () => {
  it('counts all categories and clamps editor ranges', () => {
    const diagnostics: Diagnostic[] = [
      {
        code: 'a',
        category: 'syntax',
        severity: 'error',
        message: 'a',
        range: { start: { line: 99, character: 99 }, end: { line: 100, character: 3 } }
      },
      { code: 'b', category: 'informational', severity: 'info', message: 'b' }
    ];
    expect(countDiagnostics(diagnostics)).toEqual({
      syntax: 1,
      semantic: 0,
      deferred: 0,
      informational: 1
    });
    expect(diagnosticOffsets('one\ntwo', diagnostics[0]!)).toEqual({ from: 7, to: 7 });
    expect(diagnosticOffsets('one', diagnostics[1]!)).toEqual({ from: 0, to: 1 });
  });
});

describe('transport clock', () => {
  it('resolves one loop-aware playback position for the whole transport', () => {
    // span = 4 bars * 2 s = 8 s. Loop wraps at the boundary; finite and infinite
    // (holding its final state) both clamp at the end.
    expect(timelinePositionSeconds(3, 4, 2, 'finite')).toBe(3);
    expect(timelinePositionSeconds(10, 4, 2, 'finite')).toBe(8);
    expect(timelinePositionSeconds(10, 4, 2, 'loop')).toBe(2);
    expect(timelinePositionSeconds(10, 4, 2, 'infinite')).toBe(8);
    // Nothing arranged yet: fall back to raw elapsed rather than dividing by zero.
    expect(timelinePositionSeconds(5, 0, 2, 'loop')).toBe(5);
  });

  it('reports smooth transport progress and wraps only repeating timelines', () => {
    expect(timelineProgressPercent(4, 4, 2, 'finite')).toBe(50);
    expect(timelineProgressPercent(12, 4, 2, 'finite')).toBe(100);
    expect(timelineProgressPercent(10, 4, 2, 'loop')).toBe(25);
    // Infinite holds the arrangement's final state, so it clamps like finite
    // instead of rewinding the playhead.
    expect(timelineProgressPercent(20, 4, 2, 'infinite')).toBe(100);
    expect(timelineProgressPercent(1, 0, 2, 'finite')).toBe(0);
  });

  it('formats a clock read-out', () => {
    expect(formatClock(68.9)).toBe('1:08');
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('positions', () => {
  // A beat is the meter's beatUnit note, so beat 3 is 1.0 s into the bar at 120
  // BPM whether that beat is a quarter (4/4) or an eighth (6/8).
  it('places a beat by the tempo alone, whatever the beat unit', () => {
    const position = { bar: 2, beat: { index: 3 } };
    const common = testTimeline();
    const compound = testTimeline({
      musicalContext: { tempo: 120, timeSignature: { beatsPerBar: 6, beatUnit: 8 } }
    });
    expect(positionSeconds(common, position)).toBe(2 + 1);
    expect(positionSeconds(compound, position)).toBe(3 + 1);
    expect(
      positionSeconds(compound, {
        bar: 1,
        beat: { index: 1, offset: { numerator: 1, denominator: 2 } }
      })
    ).toBe(0.25);
  });
});
