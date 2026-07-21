import { describe, expect, it } from 'vitest';
import type {
  CapabilitiesTable,
  IntentKeyword,
  IntentSupport,
  Timeline
} from '@luna-estelar/gas-protocol';
import { warningsForTimeline } from '../src/index.js';
import { validTimeline } from './support/timelines.js';

const INTENTS: readonly IntentKeyword[] = [
  'flavor',
  'key',
  'tempo',
  'time_signature',
  'timbre',
  'level',
  'notes',
  'motif'
];

function uniform(support: IntentSupport): CapabilitiesTable {
  return {
    intents: Object.fromEntries(INTENTS.map((intent) => [intent, support])) as Record<
      IntentKeyword,
      IntentSupport
    >
  };
}

function allIntentTimeline(): Timeline {
  const base = validTimeline();
  return {
    ...base,
    tracks: [
      {
        ...base.tracks[0]!,
        defaults: [
          ...base.tracks[0]!.defaults,
          {
            defaultId: 'default.pad.timbre',
            action: 'timbre',
            value: { kind: 'text', text: 'tape' }
          },
          {
            defaultId: 'default.pad.notes',
            action: 'notes',
            value: { kind: 'alda', source: 'c d' }
          },
          {
            defaultId: 'default.pad.motif',
            action: 'motif',
            value: { kind: 'alda', source: 'e f' }
          }
        ]
      },
      ...base.tracks.slice(1)
    ],
    events: [
      ...base.events,
      {
        eventId: 'event.track-flavor',
        type: 'track',
        targetId: 'track.lead',
        action: 'flavor',
        position: { bar: 9 },
        sequence: 3,
        scope: 'section',
        sectionInstanceId: 'section.verse.1',
        value: { kind: 'text', text: 'bright' }
      },
      {
        eventId: 'event.duplicate-level',
        type: 'track',
        targetId: 'track.lead',
        action: 'level',
        position: { bar: 10 },
        sequence: 4,
        scope: 'timed',
        sectionInstanceId: 'section.verse.1',
        value: { kind: 'level', value: 0.7 }
      },
      {
        eventId: 'event.duplicate-flavor',
        type: 'section',
        targetId: 'section.verse.1',
        action: 'flavor',
        position: { bar: 9 },
        sequence: 5,
        scope: 'section',
        sectionInstanceId: 'section.verse.1',
        value: { kind: 'text', text: 'narrow' }
      }
    ]
  };
}

describe('warningsForTimeline', () => {
  it('scans every authored intent in deterministic first-occurrence order', () => {
    const warnings = warningsForTimeline(allIntentTimeline(), uniform('unsupported'));
    expect(warnings.map(({ intent, trackId }) => [intent, trackId])).toEqual([
      ['tempo', undefined],
      ['time_signature', undefined],
      ['key', undefined],
      ['flavor', undefined],
      ['level', 'track.pad'],
      ['timbre', 'track.pad'],
      ['notes', 'track.pad'],
      ['motif', 'track.pad'],
      ['level', 'track.lead'],
      ['flavor', 'track.lead']
    ]);
  });

  it('deduplicates repeated authored intents per track and global scope', () => {
    const warnings = warningsForTimeline(allIntentTimeline(), uniform('unsupported'));
    expect(
      warnings.filter((warning) => warning.intent === 'flavor' && warning.trackId === undefined)
    ).toHaveLength(1);
    expect(
      warnings.filter((warning) => warning.intent === 'level' && warning.trackId === 'track.lead')
    ).toHaveLength(1);
  });

  it('reports section flavor when no global flavor precedes it', () => {
    const timeline = validTimeline();
    const withoutGlobalFlavor: Timeline = {
      ...timeline,
      globals: {}
    };
    const flavorOnly = {
      intents: { ...uniform('supported').intents, flavor: 'unsupported' }
    } satisfies CapabilitiesTable;
    const warnings = warningsForTimeline(withoutGlobalFlavor, flavorOnly);
    expect(warnings).toEqual([expect.objectContaining({ intent: 'flavor' })]);
    expect(warnings[0]?.trackId).toBeUndefined();
  });

  it('is silent for supported intents and never warns for authored global level', () => {
    expect(warningsForTimeline(allIntentTimeline(), uniform('supported'))).toEqual([]);
    const levelOnly = {
      intents: { ...uniform('supported').intents, level: 'unsupported' }
    } satisfies CapabilitiesTable;
    expect(warningsForTimeline(validTimeline(), levelOnly)).toEqual([
      expect.objectContaining({ intent: 'level', trackId: 'track.pad' }),
      expect.objectContaining({ intent: 'level', trackId: 'track.lead' })
    ]);
  });
});
