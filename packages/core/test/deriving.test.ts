import { describe, expect, it, test } from 'vitest';
import type { ArrangementInstance, IntentValue, Timeline } from '@luna-estelar/gas-protocol';
import {
  applyCommand,
  createInputState,
  effectiveStateAt,
  sectionInstanceAt,
  type Command,
  type EffectiveState,
  type EffectiveTrack,
  type InputState,
  type PlaybackPhase
} from '../src/index.js';
import { validTimeline } from './support/timelines.js';

// --- Helpers ------------------------------------------------------------------

function mustApply(state: InputState, command: Command, phase: PlaybackPhase): InputState {
  const result = applyCommand(state, command, { phase, capabilities: ALL_SUPPORTED });
  if (!result.ok) {
    throw new Error(`Expected the command to apply: ${result.failure.message}`);
  }
  return result.state;
}

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

// Builds a state with the given staged then live commands, through the real
// applyCommand path (staged while stopped, live while active).
function stateWith(timeline: Timeline, staged: Command[] = [], live: Command[] = []): InputState {
  let state = createInputState(timeline);
  for (const command of staged) state = mustApply(state, command, 'stopped');
  for (const command of live) state = mustApply(state, command, 'active');
  return state;
}

function trackOf(snapshot: EffectiveState, trackId: string): EffectiveTrack {
  const track = snapshot.tracks.find((entry) => entry.trackId === trackId);
  if (track === undefined) {
    throw new Error(`No track "${trackId}" in the snapshot.`);
  }
  return track;
}

const text = (value: string): IntentValue => ({ kind: 'text', text: value });
const level = (value: number): IntentValue => ({ kind: 'level', value });
const alda = (source: string): IntentValue => ({ kind: 'alda', source });

// Derives at a bar with the section instance the arrangement puts there — the way
// a caller without a Renderer supplies `activeSection`.
function deriveAtBar(state: InputState, bar: number, loopIteration = 0): EffectiveState {
  return effectiveStateAt(
    state,
    { bar },
    {
      loopIteration,
      activeSection: sectionInstanceAt(state.timeline, { bar })
    }
  );
}

// --- Authored base: layers 1 and 2 --------------------------------------------

describe('effectiveStateAt derives the authored base', () => {
  it('reports globals, track declarations, and defaults with no overrides', () => {
    // At bar 1 in the intro instance: the section flavor overlays the global
    // flavor, the pad plays and carries its default level, the lead is inactive.
    const snapshot = deriveAtBar(createInputState(validTimeline()), 1);

    expect(snapshot.globals).toEqual({
      flavor: text('wide'), // section flavor overlays 'cinematic' while intro is active
      level: level(0.9),
      tempo: 100,
      key: 'A minor',
      timeSignature: { beatsPerBar: 4, beatUnit: 4 }
    });
    expect(trackOf(snapshot, 'track.pad')).toEqual({
      trackId: 'track.pad',
      name: 'Pad',
      description: 'warm pad',
      active: true,
      level: level(0.5)
    });
    expect(trackOf(snapshot, 'track.lead')).toEqual({
      trackId: 'track.lead',
      name: 'Lead',
      description: '',
      active: false
    });
  });

  it('skips section-scoped events when no active section is supplied', () => {
    // Same bar, but activeSection omitted: the section flavor does not overlay,
    // so the global flavor falls back to the authored default. Timed events
    // (the pad's play) still apply.
    const snapshot = effectiveStateAt(createInputState(validTimeline()), { bar: 1 });
    expect(snapshot.globals.flavor).toEqual(text('cinematic'));
    expect(trackOf(snapshot, 'track.pad').active).toBe(true);
  });

  it('expires a section flavor at the instance boundary', () => {
    const state = createInputState(validTimeline());
    // Present while the intro is active (bar 8 is the last intro bar)...
    expect(deriveAtBar(state, 8).globals.flavor).toEqual(text('wide'));
    // ...gone once the verse instance is active (bar 9).
    expect(deriveAtBar(state, 9).globals.flavor).toEqual(text('cinematic'));
    // The verse's authored level event has taken effect on the lead by bar 9.
    expect(trackOf(deriveAtBar(state, 9), 'track.lead').level).toEqual(level(0.8));
    expect(trackOf(deriveAtBar(state, 1), 'track.lead').level).toBeUndefined();
  });
});

// --- sectionInstanceAt --------------------------------------------------------

describe('sectionInstanceAt maps bars to instances end-exclusively', () => {
  it('agrees with the arrangement for every bar 1..arrangedBars, and is empty past it', () => {
    const timeline = validTimeline();
    for (let bar = 1; bar <= 8; bar++) {
      expect(sectionInstanceAt(timeline, { bar })?.sectionInstanceId).toBe('section.intro.0');
    }
    for (let bar = 9; bar <= 16; bar++) {
      expect(sectionInstanceAt(timeline, { bar })?.sectionInstanceId).toBe('section.verse.1');
    }
    // `end` is exclusive: bar 17 is past the arranged length.
    expect(sectionInstanceAt(timeline, { bar: 17 })).toBeUndefined();
  });
});

// --- Five-layer precedence ----------------------------------------------------

// A track with an authored flavor default and an authored flavor event at bar 2,
// inside one section instance (bars 1..4). The event is `timed`, so activeSection
// does not gate it — this isolates layer precedence and clear-restore behavior.
function precedenceTimeline(): Timeline {
  return {
    formatVersion: { major: 1, minor: 0 },
    timelineId: 'precedence',
    languageVersion: '1.0',
    compilerVersion: '0.1.0',
    source: { name: 'precedence.gas' },
    playback: { mode: 'finite', declaredBars: 4 },
    arrangedBars: 4,
    globals: {},
    tracks: [
      {
        trackId: 'track.a',
        name: 'A',
        description: '',
        defaults: [
          {
            defaultId: 'd.a.flavor',
            action: 'flavor',
            value: { kind: 'text', text: 'authored-default' }
          }
        ]
      }
    ],
    arrangement: [
      {
        sectionInstanceId: 'sec.0',
        sectionName: 'sec',
        callIndex: 0,
        start: { bar: 1 },
        end: { bar: 5 }
      }
    ],
    resources: [],
    events: [
      {
        eventId: 'e.flavor',
        type: 'track',
        targetId: 'track.a',
        action: 'flavor',
        position: { bar: 2 },
        sequence: 0,
        scope: 'timed',
        value: { kind: 'text', text: 'authored-event' }
      }
    ]
  };
}

const setA = (value: string): Command => ({ kind: 'setTrackFlavor', trackId: 'track.a', value });
const clearA: Command = { kind: 'clearTrackFlavor', trackId: 'track.a' };

const PRECEDENCE: ReadonlyArray<
  readonly [
    name: string,
    bar: number,
    staged: Command[],
    live: Command[],
    expected: IntentValue | undefined
  ]
> = [
  // At bar 2, the authored event (layer 4) sits above staged (layer 3) and the base.
  ['no overrides at the event bar', 2, [], [], text('authored-event')],
  ['a staged set loses to the authored event', 2, [setA('staged')], [], text('authored-event')],
  ['a live set wins over the authored event', 2, [], [setA('live')], text('live')],
  ['a staged clear still loses to the authored event', 2, [clearA], [], text('authored-event')],
  ['a live clear restores the authored event value', 2, [], [clearA], text('authored-event')],
  [
    'a live set then clear falls back to the event',
    2,
    [],
    [setA('live1'), clearA],
    text('authored-event')
  ],
  ['a live clear then set — the later set wins', 2, [], [clearA, setA('live2')], text('live2')],
  ['a live set beats a staged set', 2, [setA('staged')], [setA('live')], text('live')],
  // Before the event bar, layer 4 is empty, so staged (layer 3) shows through.
  ['a staged set shows before the event', 1, [setA('staged')], [], text('staged')],
  [
    'a live clear restores the surviving staged value',
    1,
    [setA('staged')],
    [clearA],
    text('staged')
  ],
  ['a staged clear falls back to the authored default', 1, [clearA], [], text('authored-default')],
  ['the authored default with no overrides', 1, [], [], text('authored-default')]
];

describe('effectiveStateAt resolves the five layers in order', () => {
  test.each(PRECEDENCE)('%s', (_name, bar, staged, live, expected) => {
    const state = stateWith(precedenceTimeline(), staged, live);
    const flavor = trackOf(deriveAtBar(state, bar), 'track.a').flavor;
    if (expected === undefined) {
      expect(flavor).toBeUndefined();
    } else {
      expect(flavor).toEqual(expected);
    }
  });
});

// --- Track activity -----------------------------------------------------------

// A track played at bar 1 and stopped at bar 3, in one instance (bars 1..4).
function activityTimeline(): Timeline {
  const base = precedenceTimeline();
  return {
    ...base,
    timelineId: 'activity',
    tracks: [{ trackId: 'track.a', name: 'A', description: '', defaults: [] }],
    events: [
      {
        eventId: 'e.play',
        type: 'track',
        targetId: 'track.a',
        action: 'play',
        position: { bar: 1 },
        sequence: 0,
        scope: 'timed'
      },
      {
        eventId: 'e.stop',
        type: 'track',
        targetId: 'track.a',
        action: 'stop',
        position: { bar: 3 },
        sequence: 0,
        scope: 'timed'
      }
    ]
  };
}

describe('effectiveStateAt derives track activity from play/stop', () => {
  it('follows authored play and stop events by position', () => {
    const state = createInputState(activityTimeline());
    expect(trackOf(deriveAtBar(state, 1), 'track.a').active).toBe(true);
    expect(trackOf(deriveAtBar(state, 2), 'track.a').active).toBe(true);
    expect(trackOf(deriveAtBar(state, 3), 'track.a').active).toBe(false);
  });

  it('lets a live stop override the authored play', () => {
    const state = stateWith(activityTimeline(), [], [{ kind: 'stopTrack', trackId: 'track.a' }]);
    expect(trackOf(deriveAtBar(state, 1), 'track.a').active).toBe(false);
  });

  it('lets an authored stop event win over a staged play (layer 4 over layer 3)', () => {
    const state = stateWith(activityTimeline(), [{ kind: 'playTrack', trackId: 'track.a' }], []);
    // At bar 3 the authored stop applies after the staged play.
    expect(trackOf(deriveAtBar(state, 3), 'track.a').active).toBe(false);
  });
});

// --- Position ordering --------------------------------------------------------

describe('effectiveStateAt orders layer-4 events by position then sequence', () => {
  it('resolves same-position events by source sequence', () => {
    const timeline: Timeline = {
      ...precedenceTimeline(),
      timelineId: 'sequence',
      tracks: [{ trackId: 'track.a', name: 'A', description: '', defaults: [] }],
      events: [
        {
          eventId: 'e.1',
          type: 'track',
          targetId: 'track.a',
          action: 'flavor',
          position: { bar: 1 },
          sequence: 1,
          scope: 'timed',
          value: { kind: 'text', text: 'second' }
        },
        {
          eventId: 'e.0',
          type: 'track',
          targetId: 'track.a',
          action: 'flavor',
          position: { bar: 1 },
          sequence: 0,
          scope: 'timed',
          value: { kind: 'text', text: 'first' }
        }
      ]
    };
    // Both at bar 1; the higher sequence applies last and wins, regardless of array order.
    expect(trackOf(deriveAtBar(createInputState(timeline), 1), 'track.a').flavor).toEqual(
      text('second')
    );
  });

  it('includes beat positions at or before the position and excludes those after', () => {
    const timeline: Timeline = {
      ...precedenceTimeline(),
      timelineId: 'beats',
      tracks: [{ trackId: 'track.a', name: 'A', description: '', defaults: [] }],
      events: [
        {
          eventId: 'e.on',
          type: 'track',
          targetId: 'track.a',
          action: 'flavor',
          position: { bar: 1, beat: { index: 0 } },
          sequence: 0,
          scope: 'timed',
          value: { kind: 'text', text: 'onbeat' }
        },
        {
          eventId: 'e.off',
          type: 'track',
          targetId: 'track.a',
          action: 'flavor',
          position: { bar: 1, beat: { index: 0, offset: { numerator: 1, denominator: 2 } } },
          sequence: 1,
          scope: 'timed',
          value: { kind: 'text', text: 'offbeat' }
        }
      ]
    };
    const state = createInputState(timeline);
    const section = sectionInstanceAt(timeline, { bar: 1 });
    // At the half-beat, both events are at or before, so the later one wins.
    expect(
      trackOf(
        effectiveStateAt(
          state,
          { bar: 1, beat: { index: 0, offset: { numerator: 1, denominator: 2 } } },
          { activeSection: section }
        ),
        'track.a'
      ).flavor
    ).toEqual(text('offbeat'));
    // On the beat, the half-beat event is still in the future and is excluded.
    expect(
      trackOf(
        effectiveStateAt(state, { bar: 1, beat: { index: 0 } }, { activeSection: section }),
        'track.a'
      ).flavor
    ).toEqual(text('onbeat'));
  });
});

// --- Wrapped override values --------------------------------------------------

describe('effectiveStateAt wraps override payloads as intent values', () => {
  it('wraps flavor, level, and alda overrides into protocol values', () => {
    const state = stateWith(
      precedenceTimeline(),
      [],
      [
        { kind: 'setTrackFlavor', trackId: 'track.a', value: 'glassy' },
        { kind: 'setTrackLevel', trackId: 'track.a', value: 0.3 },
        { kind: 'setTrackNotes', trackId: 'track.a', alda: 'c d e' },
        { kind: 'setTrackMotif', trackId: 'track.a', alda: 'g2' },
        { kind: 'setTrackTimbre', trackId: 'track.a', value: 'tape piano' }
      ]
    );
    const track = trackOf(deriveAtBar(state, 1), 'track.a');
    expect(track.flavor).toEqual(text('glassy'));
    expect(track.level).toEqual(level(0.3));
    expect(track.notes).toEqual(alda('c d e'));
    expect(track.motif).toEqual(alda('g2'));
    expect(track.timbre).toEqual(text('tape piano'));
  });

  it('wraps global overrides and keeps tempo a plain number', () => {
    const state = stateWith(
      precedenceTimeline(),
      [],
      [
        { kind: 'setGlobalFlavor', value: 'dusk' },
        { kind: 'setGlobalLevel', value: 0.2 },
        { kind: 'setTempo', bpm: 88 }
      ]
    );
    const snapshot = deriveAtBar(state, 1);
    expect(snapshot.globals.flavor).toEqual(text('dusk'));
    expect(snapshot.globals.level).toEqual(level(0.2));
    expect(snapshot.globals.tempo).toBe(88);
  });
});

// --- Completeness -------------------------------------------------------------

describe('effectiveStateAt returns every track', () => {
  it('includes authored and host tracks, active and inactive', () => {
    const state = stateWith(validTimeline(), [
      { kind: 'defineTrack', id: 'host.synth', name: 'Synth' }
    ]);
    const snapshot = deriveAtBar(state, 1);
    expect(snapshot.tracks.map((track) => track.trackId)).toEqual([
      'track.pad',
      'track.lead',
      'host.synth'
    ]);
    const host = trackOf(snapshot, 'host.synth');
    expect(host).toEqual({ trackId: 'host.synth', name: 'Synth', active: false });
  });

  it('falls a host track name back to its id', () => {
    const state = stateWith(validTimeline(), [{ kind: 'defineTrack', id: 'host.bare' }]);
    expect(trackOf(deriveAtBar(state, 1), 'host.bare').name).toBe('host.bare');
  });
});

// --- Loop iteration -----------------------------------------------------------

describe('effectiveStateAt is inert across loop iterations in v1', () => {
  it('derives the same snapshot for iteration 1 and 2 and keeps live overrides', () => {
    const state = stateWith(validTimeline(), [], [{ kind: 'setGlobalFlavor', value: 'held' }]);
    const first = deriveAtBar(state, 9, 1);
    const second = deriveAtBar(state, 9, 2);
    expect(second).toEqual(first);
    // The live override persists across the boundary (it lives in input state).
    expect(second.globals.flavor).toEqual(text('held'));
  });
});

// --- Immutability -------------------------------------------------------------

describe('effectiveStateAt is a pure derivation', () => {
  it('returns a deeply frozen snapshot', () => {
    const state = stateWith(
      precedenceTimeline(),
      [],
      [{ kind: 'setTrackFlavor', trackId: 'track.a', value: 'x' }]
    );
    const snapshot = deriveAtBar(state, 2);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.globals)).toBe(true);
    expect(Object.isFrozen(snapshot.tracks)).toBe(true);
    for (const track of snapshot.tracks) {
      expect(Object.isFrozen(track)).toBe(true);
    }
    // Values Core wraps are frozen too.
    expect(Object.isFrozen(trackOf(snapshot, 'track.a').flavor)).toBe(true);
  });

  it('never touches the input state and is stable across repeated calls', () => {
    const state = stateWith(
      validTimeline(),
      [{ kind: 'setGlobalLevel', value: 0.1 }],
      [{ kind: 'playTrack', trackId: 'track.lead' }]
    );
    const before = JSON.stringify(state);
    const first = deriveAtBar(state, 9);
    const second = deriveAtBar(state, 9);
    expect(JSON.stringify(state)).toBe(before);
    expect(second).toEqual(first);
  });
});
