import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_SCHEMA_IDS,
  validateTimelinePayload
} from '@luna-estelar/gas-protocol/validation';
import exportedTimelineSchema from '@luna-estelar/gas-protocol/schemas/1.0/timeline.schema.json' with { type: 'json' };
import type { Timeline } from '../src/index.js';

const TIMELINE: Timeline = {
  formatVersion: { major: 1, minor: 0 },
  timelineId: 'timeline.test',
  languageVersion: '1.0',
  compilerVersion: '0.1.0',
  source: { name: 'test.gas', mediaType: 'text/vnd.gas' },
  playback: { mode: 'finite', declaredBars: 1 },
  arrangedBars: 1,
  globals: {},
  tracks: [],
  arrangement: [
    {
      sectionInstanceId: 'section.test.0',
      sectionName: 'test',
      callIndex: 0,
      start: { bar: 1 },
      end: { bar: 2 }
    }
  ],
  resources: [],
  events: []
};

describe('canonical protocol validation', () => {
  it('exports stable schema ids and accepts a protocol 1.0 timeline', () => {
    expect(PROTOCOL_SCHEMA_IDS.timeline).toBe(
      'https://gas.luna-estelar.com/protocol/1.0/timeline.schema.json'
    );
    expect(exportedTimelineSchema.$id).toBe(PROTOCOL_SCHEMA_IDS.timeline);
    expect(validateTimelinePayload(TIMELINE)).toEqual({ ok: true, value: TIMELINE });
  });

  it('returns sanitized issues for an unknown field', () => {
    const result = validateTimelinePayload({ ...TIMELINE, extra: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instancePath: '',
          keyword: 'additionalProperties'
        })
      ])
    );
    expect(Object.isFrozen(result.issues)).toBe(true);
    expect(result.issues[0]).not.toHaveProperty('params');
    expect(result.issues[0]).not.toHaveProperty('data');
  });

  it('rejects every format except exactly 1.0', () => {
    expect(validateTimelinePayload({ ...TIMELINE, formatVersion: { major: 1, minor: 1 } }).ok).toBe(
      false
    );
    expect(validateTimelinePayload({ ...TIMELINE, formatVersion: { major: 2, minor: 0 } }).ok).toBe(
      false
    );
  });
});
