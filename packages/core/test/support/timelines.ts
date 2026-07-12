// Hand-built timelines keep Core package tests independent of the compiler.
// Root integration tests cover real compiled documents.

import type { Timeline } from '@luna-estelar/gas-protocol';

// A complete, valid timeline. Every rejection test starts from a fresh copy of
// this and breaks exactly one thing.
export function validTimeline(): Timeline {
  return {
    formatVersion: { major: 1, minor: 0 },
    timelineId: 'timeline',
    languageVersion: '1.0',
    compilerVersion: '0.1.0',
    source: { name: 'test.gas', mediaType: 'text/vnd.gas', byteLength: 128 },
    playback: { mode: 'finite', declaredBars: 16 },
    arrangedBars: 16,
    musicalContext: { tempo: 100, timeSignature: { beatsPerBar: 4, beatUnit: 4 }, key: 'A minor' },
    globals: { flavor: { kind: 'text', text: 'cinematic' }, level: { kind: 'level', value: 0.9 } },
    tracks: [
      {
        trackId: 'track.pad',
        name: 'Pad',
        description: 'warm pad',
        defaults: [
          { defaultId: 'default.pad.level', action: 'level', value: { kind: 'level', value: 0.5 } }
        ]
      },
      { trackId: 'track.lead', name: 'Lead', description: '', defaults: [] }
    ],
    arrangement: [
      {
        sectionInstanceId: 'section.intro.0',
        sectionName: 'intro',
        callIndex: 0,
        start: { bar: 1 },
        end: { bar: 9 }
      },
      {
        sectionInstanceId: 'section.verse.1',
        sectionName: 'verse',
        callIndex: 1,
        start: { bar: 9 },
        end: { bar: 17 }
      }
    ],
    resources: [],
    events: [
      {
        eventId: 'event.0',
        type: 'track',
        targetId: 'track.pad',
        action: 'play',
        position: { bar: 1 },
        sequence: 0,
        scope: 'timed',
        sectionInstanceId: 'section.intro.0'
      },
      {
        eventId: 'event.1',
        type: 'section',
        targetId: 'section.intro.0',
        action: 'flavor',
        position: { bar: 1 },
        sequence: 1,
        scope: 'section',
        sectionInstanceId: 'section.intro.0',
        value: { kind: 'text', text: 'wide' }
      },
      {
        eventId: 'event.2',
        type: 'track',
        targetId: 'track.lead',
        action: 'level',
        position: { bar: 9 },
        sequence: 2,
        scope: 'timed',
        sectionInstanceId: 'section.verse.1',
        value: { kind: 'level', value: 0.8 }
      }
    ]
  };
}

// A valid globals-only timeline: a finite length with no section calls, so the
// arrangement is empty and the arranged length is 0. The compiler produces this
// shape for a document whose sections are never called.
export function globalsOnlyTimeline(): Timeline {
  return {
    formatVersion: { major: 1, minor: 0 },
    timelineId: 'timeline',
    languageVersion: '1.0',
    compilerVersion: '0.1.0',
    source: { mediaType: 'text/vnd.gas', byteLength: 32 },
    playback: { mode: 'finite', declaredBars: 4 },
    arrangedBars: 0,
    globals: {},
    tracks: [{ trackId: 'track.drums', name: 'Drums', description: '', defaults: [] }],
    arrangement: [],
    resources: [],
    events: []
  };
}
