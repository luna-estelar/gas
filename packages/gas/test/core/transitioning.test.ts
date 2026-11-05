import { describe, expect, it } from 'vitest';
import type { IntentValue, Timeline } from '../../src/protocol/index.js';
import {
  applyCommand,
  applyNewTimeline,
  authoredEventSchedule,
  createInputState,
  effectiveStateAt,
  sectionInstanceAt,
  type Command,
  type InputState
} from '../../src/core/index.js';
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
const OPTIONS = { capabilities: ALL_SUPPORTED };

function mustApply(state: InputState, command: Command): InputState {
  const result = applyCommand(state, command, OPTIONS);
  if (!result.ok) {
    throw new Error(`Expected the command to apply: ${result.failure.message}`);
  }
  return result.state;
}

// An app track with a value, a document track value and a global value.
function loadedState(): InputState {
  let state = createInputState(validTimeline());
  state = mustApply(state, { kind: 'defineTrack', id: 'app.synth', name: 'Synth' });
  state = mustApply(state, { kind: 'playTrack', trackId: 'app.synth' });
  state = mustApply(state, { kind: 'setTrackLevel', trackId: 'track.lead', value: 0.3 });
  state = mustApply(state, { kind: 'setGlobalFlavor', value: 'app flavor' });
  return state;
}

// A second document that keeps track.pad, drops track.lead and adds track.lead2.
function nextTimeline(): Timeline {
  const timeline = validTimeline();
  return {
    ...timeline,
    timelineId: 'next',
    tracks: [
      timeline.tracks[0],
      { trackId: 'track.lead2', name: 'Lead 2', description: '', defaults: [] }
    ],
    events: timeline.events.filter(
      (event) => event.type !== 'track' || event.targetId === 'track.pad'
    )
  };
}

// --- New timeline -------------------------------------------------------------

describe('applyNewTimeline', () => {
  it("'keep' carries values over and drops values for tracks that are gone", () => {
    const timeline = nextTimeline();
    const result = applyNewTimeline(loadedState(), timeline, 'keep', OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.timeline).toBe(timeline);
    expect(result.state.appTracks).toEqual([{ id: 'app.synth', name: 'Synth' }]);
    expect(result.state.appValues).toEqual([
      { kind: 'playTrack', trackId: 'app.synth' },
      { kind: 'setGlobalFlavor', value: 'app flavor' }
    ]);
    expect(result.warnings).toEqual([
      {
        code: 'app-value-dropped',
        trackId: 'track.lead',
        command: { kind: 'setTrackLevel', trackId: 'track.lead', value: 0.3 },
        message: expect.stringContaining('track.lead')
      }
    ]);
  });

  it("'keep' fails when the new document declares an app track's id", () => {
    const state = loadedState();
    const timeline: Timeline = {
      ...validTimeline(),
      tracks: [
        ...validTimeline().tracks,
        { trackId: 'app.synth', name: 'Doc synth', description: '', defaults: [] }
      ]
    };
    const result = applyNewTimeline(state, timeline, 'keep', OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ code: 'duplicate-track', trackId: 'app.synth' });
    expect(state.appTracks).toEqual([{ id: 'app.synth', name: 'Synth' }]);
    expect(state.appValues).toHaveLength(3);
  });

  it("'clear' and a command list allow a document track with an app track's id", () => {
    const timeline: Timeline = {
      ...validTimeline(),
      tracks: [
        ...validTimeline().tracks,
        { trackId: 'app.synth', name: 'Doc synth', description: '', defaults: [] }
      ]
    };
    expect(applyNewTimeline(loadedState(), timeline, 'clear', OPTIONS).ok).toBe(true);
    expect(applyNewTimeline(loadedState(), timeline, [], OPTIONS).ok).toBe(true);
  });

  it("'clear' starts with no app tracks and no app values", () => {
    const timeline = nextTimeline();
    const result = applyNewTimeline(loadedState(), timeline, 'clear', OPTIONS);
    expect(result).toEqual({ ok: true, state: createInputState(timeline), warnings: [] });
  });

  it('a command list replaces the app values', () => {
    const timeline = globalsOnlyTimeline();
    const result = applyNewTimeline(
      loadedState(),
      timeline,
      [
        { kind: 'defineTrack', id: 'app.bells' },
        { kind: 'setTrackLevel', trackId: 'track.drums', value: 0.2 }
      ],
      OPTIONS
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.appTracks).toEqual([{ id: 'app.bells' }]);
    expect(result.state.appValues).toEqual([
      { kind: 'setTrackLevel', trackId: 'track.drums', value: 0.2 }
    ]);
  });

  it('a failing command list fails the whole load', () => {
    const result = applyNewTimeline(
      loadedState(),
      globalsOnlyTimeline(),
      [{ kind: 'setTrackLevel', trackId: 'track.pad', value: 0.2 }],
      OPTIONS
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('unknown-track');
  });

  it('rejects an unknown mode', () => {
    const result = applyNewTimeline(
      loadedState(),
      validTimeline(),
      'wipe' as unknown as 'keep',
      OPTIONS
    );
    expect(result.ok).toBe(false);
  });

  it('returns frozen states and leaves the original untouched', () => {
    const state = loadedState();
    const result = applyNewTimeline(state, nextTimeline(), 'keep', OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.appValues)).toBe(true);
    expect(Object.isFrozen(result.state.appTracks)).toBe(true);
    expect(state.appValues).toHaveLength(3);
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
