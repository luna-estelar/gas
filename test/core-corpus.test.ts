// Compile the language corpus and validate the resulting Core state and schedule.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { compileSource, type Timeline } from '../packages/language/src/index.js';
import {
  authoredEventSchedule,
  createInputState,
  effectiveStateAt,
  sectionInstanceAt,
  validateTimeline,
  type EffectiveState
} from '../packages/core/src/index.js';
import { comparePositions } from '../packages/core/src/positions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusRoot = path.resolve(here, '../packages/language/test/corpus');
const corpusFiles = readdirSync(corpusRoot)
  .filter((entry) => entry.endsWith('.gas'))
  .sort();
if (corpusFiles.length === 0) {
  throw new Error(`No .gas corpus documents found in ${corpusRoot}.`);
}

describe('core reads every compiled corpus timeline', () => {
  test.each(corpusFiles)('%s validates, derives across every bar, and schedules', (file) => {
    const source = readFileSync(path.join(corpusRoot, file), 'utf8');
    const result = compileSource(source, { name: file });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const timeline = result.timeline;

    // The compiler and the load-time gate agree on every timeline the language
    // can produce.
    expect(validateTimeline(timeline).ok).toBe(true);

    const state = createInputState(timeline);
    const trackIds = timeline.tracks.map((track) => track.trackId);

    for (let bar = 1; bar <= timeline.arrangedBars; bar++) {
      const activeSection = sectionInstanceAt(timeline, { bar });
      // Arrangement is contiguous from bar 1, so every bar in range is covered,
      // and the instance it returns actually contains the bar (end-exclusive).
      expect(activeSection).toBeDefined();
      expect(activeSection!.start.bar).toBeLessThanOrEqual(bar);
      expect(bar).toBeLessThan(activeSection!.end.bar);

      const snapshot = effectiveStateAt(state, { bar }, { loopIteration: 0, activeSection });

      // Completeness: one entry per authored track, in declaration order.
      expect(snapshot.tracks.map((track) => track.trackId)).toEqual(trackIds);
      // Stability: same position derived twice yields the same snapshot.
      expect(effectiveStateAt(state, { bar }, { loopIteration: 0, activeSection })).toEqual(
        snapshot
      );
      // Activity matches an independent scan of the authored play/stop events.
      for (const trackId of trackIds) {
        expect(trackActive(snapshot, trackId)).toBe(expectedActive(timeline, trackId, bar));
      }
    }

    // The schedule is ordered, unique, in range, and derivable at every point.
    const schedule = authoredEventSchedule(timeline);
    schedule.forEach((position, index) => {
      expect(position.bar).toBeGreaterThanOrEqual(1);
      expect(position.bar).toBeLessThanOrEqual(timeline.arrangedBars);
      if (index > 0) {
        expect(comparePositions(schedule[index - 1], position)).toBeLessThan(0);
      }
      const activeSection = sectionInstanceAt(timeline, position);
      const snapshot = effectiveStateAt(state, position, { loopIteration: 0, activeSection });
      expect(snapshot.tracks).toHaveLength(trackIds.length);
    });
  });
});

function trackActive(snapshot: EffectiveState, trackId: string): boolean {
  const track = snapshot.tracks.find((entry) => entry.trackId === trackId);
  if (track === undefined) {
    throw new Error(`No track "${trackId}" in the snapshot.`);
  }
  return track.active;
}

// Independent activity derivation: play/stop events are always timed, so a track
// is active at a bar iff the last play/stop targeting it at or before that bar
// (by bar then source sequence) was a play.
function expectedActive(timeline: Timeline, trackId: string, bar: number): boolean {
  let active = false;
  const events = timeline.events
    .filter(
      (event) =>
        event.type === 'track' &&
        event.targetId === trackId &&
        (event.action === 'play' || event.action === 'stop') &&
        event.position.bar <= bar
    )
    .sort((a, b) => a.position.bar - b.position.bar || a.sequence - b.sequence);
  for (const event of events) {
    active = event.action === 'play';
  }
  return active;
}
