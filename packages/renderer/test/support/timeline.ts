import type { Timeline } from '@luna-estelar/gas-protocol';

export function testTimeline(overrides: Partial<Timeline> = {}): Timeline {
  const timeline: Timeline = {
    formatVersion: { major: 1, minor: 0 },
    timelineId: 'renderer-test',
    languageVersion: '1.0',
    compilerVersion: '0.1.0',
    source: { name: 'renderer-test.gas' },
    playback: { mode: 'finite', declaredBars: 4 },
    arrangedBars: 4,
    musicalContext: { tempo: 120, timeSignature: { beatsPerBar: 4, beatUnit: 4 } },
    globals: {},
    tracks: [
      {
        trackId: 'track.pad',
        name: 'Pad',
        description: 'warm pad',
        defaults: []
      }
    ],
    arrangement: [
      {
        sectionInstanceId: 'section.main.0',
        sectionName: 'main',
        callIndex: 0,
        start: { bar: 1 },
        end: { bar: 5 }
      }
    ],
    resources: [],
    events: [
      {
        eventId: 'event.play',
        type: 'track',
        targetId: 'track.pad',
        action: 'play',
        position: { bar: 1 },
        sequence: 0,
        scope: 'timed',
        sectionInstanceId: 'section.main.0'
      }
    ]
  };
  return { ...timeline, ...overrides };
}
