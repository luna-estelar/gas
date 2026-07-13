import { describe, expect, it } from 'vitest';
import type { IntentValue, Timeline } from '@luna-estelar/gas-protocol';
import {
  applyCommand,
  applyCompletion,
  applyLoopBoundary,
  applyRetry,
  applyStop,
  authoredEventSchedule,
  createInputState,
  effectiveStateAt,
  sectionInstanceAt,
  type Command,
  type InputState,
  type PlaybackPhase
} from '../src/index.js';
import { globalsOnlyTimeline, validTimeline } from './support/timelines.js';

const ALL_SUPPORTED = {
  intents: {
    flavor: 'supported',
    key: 'supported',
    tempo: 'supported',
    time_signature: 'supported',
    timbre: 'supported',
    level: 'supported',
    notes: 'supported',
    motif: 'supported'
  }
} as const;

function mustApply(state: InputState, command: Command, phase: PlaybackPhase): InputState {
  const result = applyCommand(state, command, { phase, capabilities: ALL_SUPPORTED });
  if (!result.ok) {
    throw new Error(`Expected the command to apply: ${result.failure.message}`);
  }
  return result.state;
}

// A state carrying a host track, a staged override, and a live override — enough
// for every transition to prove what it clears and what it keeps.
function loadedState(): InputState {
  let state = createInputState(validTimeline());
  state = mustApply(state, { kind: 'defineTrack', id: 'host.synth', name: 'Synth' }, 'stopped');
  state = mustApply(state, { kind: 'setGlobalFlavor', value: 'staged' }, 'stopped');
  state = mustApply(state, { kind: 'playTrack', trackId: 'track.lead' }, 'active');
  return state;
}

// --- Override clearing --------------------------------------------------------

describe('stop, completion, and retry clear overrides and keep host tracks', () => {
  for (const [name, transition] of [
    ['applyStop', applyStop],
    ['applyCompletion', applyCompletion],
    ['applyRetry', applyRetry]
  ] as const) {
    it(`${name} empties staged and live while preserving host tracks and the timeline`, () => {
      const state = loadedState();
      const next = transition(state);
      expect(next.staged).toEqual([]);
      expect(next.live).toEqual([]);
      expect(next.hostTracks).toEqual([{ id: 'host.synth', name: 'Synth' }]);
      expect(next.timeline).toBe(state.timeline);
    });
  }

  it('applyRetry preserves host tracks specifically (the retry rule)', () => {
    const state = loadedState();
    const next = applyRetry(state);
    expect(next.hostTracks).toEqual(state.hostTracks);
    expect(next.staged).toEqual([]);
    expect(next.live).toEqual([]);
  });

  it('after stop, the authored document alone determines effective state', () => {
    // No host tracks here, so a stopped state should derive identically to a
    // freshly loaded one — the "authored document alone" sentence, tested literally.
    let state = createInputState(validTimeline());
    state = mustApply(state, { kind: 'setGlobalFlavor', value: 'staged' }, 'stopped');
    state = mustApply(state, { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.1 }, 'active');

    const stopped = applyStop(state);
    const fresh = createInputState(validTimeline());
    for (const bar of [1, 9]) {
      const options = { activeSection: sectionInstanceAt(validTimeline(), { bar }) };
      expect(effectiveStateAt(stopped, { bar }, options)).toEqual(
        effectiveStateAt(fresh, { bar }, options)
      );
    }
  });

  it('applyCompletion clears overrides exactly like applyStop', () => {
    const state = loadedState();
    expect(applyCompletion(state)).toEqual(applyStop(state));
  });
});

// --- Loop boundary ------------------------------------------------------------

describe('applyLoopBoundary preserves staged and live overrides', () => {
  it('keeps both override arrays and the host tracks (identity in v1)', () => {
    const state = loadedState();
    const next = applyLoopBoundary(state);
    expect(next.staged).toEqual(state.staged);
    expect(next.live).toEqual(state.live);
    expect(next.hostTracks).toEqual(state.hostTracks);
    expect(next.timeline).toBe(state.timeline);
  });
});

// --- Immutability -------------------------------------------------------------

describe('transitions never mutate their input', () => {
  it('returns frozen states and leaves the original untouched', () => {
    const state = loadedState();
    const next = applyStop(state);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.staged)).toBe(true);
    expect(Object.isFrozen(next.live)).toBe(true);
    expect(Object.isFrozen(next.hostTracks)).toBe(true);
    // The original still carries its overrides.
    expect(state.staged).toHaveLength(1);
    expect(state.live).toHaveLength(1);
  });
});

// --- authoredEventSchedule ----------------------------------------------------

// Two sections where the second (bars 5..8) has no event at its start bar, so its
// instance start is the only thing that puts bar 5 in the schedule. Two events
// share bar 3 (on and off the beat) to prove beat ordering; the section flavor at
// bar 1 shares its bar with the instance start to prove same-position collapse.
function scheduleTimeline(): Timeline {
  return {
    formatVersion: { major: 1, minor: 0 },
    timelineId: 'schedule',
    languageVersion: '1.0',
    compilerVersion: '0.1.0',
    source: { name: 'schedule.gas' },
    playback: { mode: 'finite', declaredBars: 8 },
    arrangedBars: 8,
    globals: {},
    tracks: [{ trackId: 'track.a', name: 'A', description: '', defaults: [] }],
    arrangement: [
      {
        sectionInstanceId: 'sec.a.0',
        sectionName: 'a',
        callIndex: 0,
        start: { bar: 1 },
        end: { bar: 5 }
      },
      {
        sectionInstanceId: 'sec.b.1',
        sectionName: 'b',
        callIndex: 1,
        start: { bar: 5 },
        end: { bar: 9 }
      }
    ],
    resources: [],
    events: [
      {
        eventId: 'e.sec',
        type: 'section',
        targetId: 'sec.a.0',
        action: 'flavor',
        position: { bar: 1 },
        sequence: 0,
        scope: 'section',
        sectionInstanceId: 'sec.a.0',
        value: { kind: 'text', text: 'A-flavor' }
      },
      {
        eventId: 'e.off',
        type: 'track',
        targetId: 'track.a',
        action: 'flavor',
        position: { bar: 3, beat: { index: 0, offset: { numerator: 1, denominator: 2 } } },
        sequence: 2,
        scope: 'timed',
        value: { kind: 'text', text: 'late' }
      },
      {
        eventId: 'e.on',
        type: 'track',
        targetId: 'track.a',
        action: 'flavor',
        position: { bar: 3, beat: { index: 0 } },
        sequence: 1,
        scope: 'timed',
        value: { kind: 'text', text: 'early' }
      }
    ]
  };
}

describe('authoredEventSchedule lists ordered, de-duplicated positions', () => {
  it('orders positions, collapses shared ones, and includes instance starts', () => {
    const schedule = authoredEventSchedule(scheduleTimeline());
    expect(schedule).toEqual([
      { bar: 1 }, // instance start collapsed with the section flavor at bar 1
      { bar: 3, beat: { index: 0 } }, // on the beat before...
      { bar: 3, beat: { index: 0, offset: { numerator: 1, denominator: 2 } } }, // ...the half beat
      { bar: 5 } // present only because sec.b starts here — no event sits at bar 5
    ]);
  });

  it('collapses same-bar events to one position', () => {
    const timeline: Timeline = {
      ...scheduleTimeline(),
      arrangement: [
        {
          sectionInstanceId: 'sec.only.0',
          sectionName: 'only',
          callIndex: 0,
          start: { bar: 1 },
          end: { bar: 9 }
        }
      ],
      events: [
        {
          eventId: 'e.1',
          type: 'track',
          targetId: 'track.a',
          action: 'flavor',
          position: { bar: 4 },
          sequence: 1,
          scope: 'timed',
          value: { kind: 'text', text: 'x' }
        },
        {
          eventId: 'e.0',
          type: 'track',
          targetId: 'track.a',
          action: 'flavor',
          position: { bar: 4 },
          sequence: 0,
          scope: 'timed',
          value: { kind: 'text', text: 'y' }
        }
      ]
    };
    expect(authoredEventSchedule(timeline)).toEqual([{ bar: 1 }, { bar: 4 }]);
  });

  it('matches the corpus-shaped fixture and a globals-only timeline', () => {
    // validTimeline: events at bars 1 and 9, instances starting at bars 1 and 9.
    expect(authoredEventSchedule(validTimeline())).toEqual([{ bar: 1 }, { bar: 9 }]);
    // No arrangement and no events yields an empty schedule.
    expect(authoredEventSchedule(globalsOnlyTimeline())).toEqual([]);
  });

  it('returns a frozen array without mutating the timeline', () => {
    const timeline = scheduleTimeline();
    const eventOrder = timeline.events.map((event) => event.eventId);
    const schedule = authoredEventSchedule(timeline);
    expect(Object.isFrozen(schedule)).toBe(true);
    // Sorting happens on a copy — the timeline's own event order is untouched.
    expect(timeline.events.map((event) => event.eventId)).toEqual(eventOrder);
  });
});

// --- Expiry boundary rationale ------------------------------------------------

describe('the schedule catches section-scoped expiry', () => {
  it('holds a section flavor at the last contained bar and drops it at the next schedule position', () => {
    const timeline = scheduleTimeline();
    const state = createInputState(timeline);
    const flavorAt = (bar: number): IntentValue | undefined =>
      effectiveStateAt(state, { bar }, { activeSection: sectionInstanceAt(timeline, { bar }) })
        .globals.flavor;

    // sec.a covers bars 1..4 (end 5 exclusive); the flavor holds through bar 4...
    expect(flavorAt(4)).toEqual({ kind: 'text', text: 'A-flavor' });
    // ...and is gone at bar 5, which is in the schedule only because of the instance start.
    expect(flavorAt(5)).toBeUndefined();
    expect(authoredEventSchedule(timeline)).toContainEqual({ bar: 5 });
  });
});
