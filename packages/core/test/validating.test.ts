import { describe, expect, test } from 'vitest';
import { validateTimeline, type TimelineProblemCode } from '../src/index.js';
import { globalsOnlyTimeline, validTimeline } from './support/timelines.js';

describe('validateTimeline accepts well-formed timelines', () => {
  test('the corpus-shaped valid timeline has no problems', () => {
    const result = validateTimeline(validTimeline());
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  const ACCEPTED: ReadonlyArray<readonly [name: string, timeline: unknown]> = [
    ['finite', validTimeline()],
    ['loop', { ...validTimeline(), playback: { mode: 'loop', declaredBars: 16 } }],
    ['infinite', { ...validTimeline(), playback: { mode: 'infinite' } }],
    ['globals-only with an empty arrangement', globalsOnlyTimeline()]
  ];

  test.each(ACCEPTED)('accepts a %s timeline', (_name, timeline) => {
    expect(validateTimeline(timeline).ok).toBe(true);
  });
});

// Each case starts from a fresh valid timeline and breaks exactly one thing.
type Break = (timeline: any) => void;

const REJECTIONS: ReadonlyArray<readonly [name: string, brk: Break, code: TimelineProblemCode]> = [
  [
    'an unsupported major format version',
    (t) => (t.formatVersion.major = 2),
    'unsupported-format-version'
  ],
  ['an empty timeline id', (t) => (t.timelineId = ''), 'invalid-shape'],
  ['a missing track list', (t) => delete t.tracks, 'invalid-shape'],
  ['an unknown playback mode', (t) => (t.playback = { mode: 'once' }), 'invalid-shape'],
  [
    'a finite length below one bar',
    (t) => (t.playback = { mode: 'finite', declaredBars: 0 }),
    'invalid-playback'
  ],
  ['a duplicate track id', (t) => (t.tracks[1].trackId = t.tracks[0].trackId), 'duplicate-id'],
  ['a duplicate event id', (t) => (t.events[1].eventId = t.events[0].eventId), 'duplicate-id'],
  [
    'a duplicate section instance id',
    (t) => (t.arrangement[1].sectionInstanceId = t.arrangement[0].sectionInstanceId),
    'duplicate-id'
  ],
  [
    'a duplicate resource id',
    (t) => {
      t.resources.push({
        resourceId: 'res.a',
        kind: 'audio',
        uri: 'a.wav',
        mediaType: 'audio/wav'
      });
      t.resources.push({
        resourceId: 'res.a',
        kind: 'audio',
        uri: 'b.wav',
        mediaType: 'audio/wav'
      });
    },
    'duplicate-id'
  ],
  [
    'an event targeting an undeclared track',
    (t) => (t.events[0].targetId = 'track.ghost'),
    'unresolved-reference'
  ],
  [
    'a section event targeting an unknown instance',
    (t) => (t.events[1].targetId = 'section.ghost.9'),
    'unresolved-reference'
  ],
  [
    'an event scoped to an unknown instance',
    (t) => (t.events[0].sectionInstanceId = 'section.ghost.9'),
    'unresolved-reference'
  ],
  [
    'a value referring to a missing resource',
    (t) =>
      t.tracks[1].defaults.push({
        defaultId: 'default.lead.timbre',
        action: 'timbre',
        value: { kind: 'resource', resourceId: 'res.missing' }
      }),
    'unresolved-reference'
  ],
  [
    'an event past the arranged length',
    (t) => (t.events[0].position.bar = 99),
    'position-out-of-range'
  ],
  [
    'a gap between sections',
    (t) => (t.arrangement[1].start.bar = 10),
    'arrangement-not-contiguous'
  ],
  [
    'an arrangement not starting at bar 1',
    (t) => (t.arrangement[0].start.bar = 2),
    'arrangement-not-contiguous'
  ],
  [
    'an arranged length longer than the sections',
    (t) => (t.arrangedBars = 20),
    'arrangement-not-contiguous'
  ],
  [
    'an empty arrangement with a non-zero arranged length',
    (t) => {
      t.arrangement = [];
      t.events = [];
    },
    'arrangement-not-contiguous'
  ],
  ['a global level above one', (t) => (t.globals.level.value = 1.5), 'invalid-level'],
  [
    'a track default level above one',
    (t) => (t.tracks[0].defaults[0].value.value = 2),
    'invalid-level'
  ],
  ['an event level below zero', (t) => (t.events[2].value.value = -0.1), 'invalid-level']
];

describe('validateTimeline rejects broken timelines', () => {
  test.each(REJECTIONS)('rejects %s', (_name, brk, code) => {
    const timeline = validTimeline();
    brk(timeline);
    const result = validateTimeline(timeline);
    expect(result.ok).toBe(false);
    expect(result.problems.map((problem) => problem.code)).toContain(code);
    for (const problem of result.problems) {
      expect(problem.message.length).toBeGreaterThan(0);
    }
  });

  test('a non-object timeline is a shape problem', () => {
    for (const value of [null, undefined, 42, 'timeline', []]) {
      const result = validateTimeline(value);
      expect(result.ok).toBe(false);
      expect(result.problems.map((problem) => problem.code)).toContain('invalid-shape');
    }
  });
});
