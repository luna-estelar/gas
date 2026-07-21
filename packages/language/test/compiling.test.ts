import { describe, expect, test } from 'vitest';
import { compileSource, type GasCompileResult, type Timeline } from '../src/index.js';

function compile(source: string): GasCompileResult {
  return compileSource(source);
}

function expectTimeline(result: GasCompileResult): Timeline {
  if (!result.ok) {
    throw new Error(
      `Expected a compiled timeline, got diagnostics: ${result.diagnostics.map((d) => d.code).join(', ')}`
    );
  }
  return result.timeline;
}

function codes(result: GasCompileResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

const FULL_DOCUMENT = `
tempo 104
key "C minor"
time_signature 4/4
length bars 16 loop
flavor "lofi, intimate, late night"
level 0.8

track guitar "A bright, clean stratocaster"
track drums "Lofi breakbeat"

drums.timbre "dry drum machine"

section chorus:
    length bars 8
    flavor "wide opening"
    guitar.flavor "muted"

    bar 1:
        drums.play
        guitar.play
    bar 5:
        drums.flavor "buildup"

section verse:
    length bars 8
    bar 1:
        guitar.play

chorus()
verse()
`;

describe('GAS compiling', () => {
  test('preserves fractional tempo exactly in the timeline', () => {
    const timeline = expectTimeline(compile('tempo 123.5\nlength bars 4\n'));
    expect(timeline.musicalContext?.tempo).toBe(123.5);
  });

  test('emits musical-time header, context, globals, and playback', () => {
    const timeline = expectTimeline(compile(FULL_DOCUMENT));

    expect(timeline.formatVersion).toEqual({ major: 1, minor: 0 });
    expect(timeline.timelineId).toBe('timeline');
    expect(timeline.playback).toEqual({ mode: 'loop', declaredBars: 16 });
    expect(timeline.arrangedBars).toBe(16);
    expect(timeline.musicalContext).toEqual({
      tempo: 104,
      timeSignature: { beatsPerBar: 4, beatUnit: 4 },
      key: 'C minor'
    });
    expect(timeline.globals).toEqual({
      flavor: { kind: 'text', text: 'lofi, intimate, late night' },
      level: { kind: 'level', value: 0.8 }
    });
    expect(timeline.resources).toEqual([]);
    expect(timeline.source.mediaType).toBe('text/vnd.gas');
    expect(timeline.source.byteLength).toBeGreaterThan(0);
  });

  test('declares tracks with valued defaults only', () => {
    const timeline = expectTimeline(compile(FULL_DOCUMENT));

    expect(timeline.tracks.map((track) => track.trackId)).toEqual(['track.guitar', 'track.drums']);
    const guitar = timeline.tracks[0];
    expect(guitar).toMatchObject({
      trackId: 'track.guitar',
      name: 'guitar',
      description: 'A bright, clean stratocaster',
      defaults: []
    });

    const drums = timeline.tracks[1];
    expect(drums?.defaults).toEqual([
      expect.objectContaining({
        defaultId: 'default.drums.timbre',
        action: 'timbre',
        value: { kind: 'text', text: 'dry drum machine' }
      })
    ]);
  });

  test('places section instances in absolute musical time', () => {
    const timeline = expectTimeline(compile(FULL_DOCUMENT));

    expect(timeline.arrangement).toEqual([
      expect.objectContaining({
        sectionInstanceId: 'section.chorus.0',
        sectionName: 'chorus',
        callIndex: 0,
        start: { bar: 1 },
        end: { bar: 9 }
      }),
      expect.objectContaining({
        sectionInstanceId: 'section.verse.1',
        sectionName: 'verse',
        callIndex: 1,
        start: { bar: 9 },
        end: { bar: 17 }
      })
    ]);
  });

  test('orders events by position then source, with stable ids and sequences', () => {
    const timeline = expectTimeline(compile(FULL_DOCUMENT));

    const summary = timeline.events.map((event) => ({
      eventId: event.eventId,
      sequence: event.sequence,
      type: event.type,
      action: event.action,
      bar: event.position.bar,
      scope: event.scope,
      target: event.targetId
    }));

    expect(summary).toEqual([
      {
        eventId: 'event.0000',
        sequence: 0,
        type: 'section',
        action: 'flavor',
        bar: 1,
        scope: 'section',
        target: 'section.chorus.0'
      },
      {
        eventId: 'event.0001',
        sequence: 1,
        type: 'track',
        action: 'flavor',
        bar: 1,
        scope: 'section',
        target: 'track.guitar'
      },
      {
        eventId: 'event.0002',
        sequence: 2,
        type: 'track',
        action: 'play',
        bar: 1,
        scope: 'timed',
        target: 'track.drums'
      },
      {
        eventId: 'event.0003',
        sequence: 3,
        type: 'track',
        action: 'play',
        bar: 1,
        scope: 'timed',
        target: 'track.guitar'
      },
      {
        eventId: 'event.0004',
        sequence: 4,
        type: 'track',
        action: 'flavor',
        bar: 5,
        scope: 'timed',
        target: 'track.drums'
      },
      {
        eventId: 'event.0005',
        sequence: 5,
        type: 'track',
        action: 'play',
        bar: 9,
        scope: 'timed',
        target: 'track.guitar'
      }
    ]);
  });

  test('carries provenance and section-instance links on events', () => {
    const timeline = expectTimeline(compile(FULL_DOCUMENT));

    const sectionFlavor = timeline.events[0];
    expect(sectionFlavor).toMatchObject({
      type: 'section',
      sectionInstanceId: 'section.chorus.0',
      value: { kind: 'text', text: 'wide opening' },
      provenance: expect.objectContaining({
        sectionName: 'chorus',
        callIndex: 0,
        sectionPosition: { bar: 1 }
      })
    });

    const buildup = timeline.events[4];
    expect(buildup?.provenance).toMatchObject({
      sectionName: 'chorus',
      callIndex: 0,
      sectionPosition: { bar: 5 }
    });
    expect(buildup?.provenance?.sourceRange).toBeDefined();
  });

  test('play/stop events carry no value', () => {
    const timeline = expectTimeline(compile(FULL_DOCUMENT));
    const plays = timeline.events.filter(
      (event) => event.type === 'track' && event.action === 'play'
    );
    expect(plays.length).toBeGreaterThan(0);
    for (const play of plays) {
      expect('value' in play).toBe(false);
    }
  });

  test('compiles a globals-only document to an empty arrangement', () => {
    const result = compile(`
tempo 120
length bars 4
track drums "Lofi breakbeat"
`);
    const timeline = expectTimeline(result);

    expect(codes(result)).toContain('empty-arrangement');
    expect(timeline.playback).toEqual({ mode: 'finite', declaredBars: 4 });
    expect(timeline.arrangedBars).toBe(0);
    expect(timeline.arrangement).toEqual([]);
    expect(timeline.events).toEqual([]);
    expect(timeline.tracks).toEqual([
      expect.objectContaining({ trackId: 'track.drums', defaults: [] })
    ]);
  });

  test('omits musicalContext when no timing globals are authored', () => {
    const timeline = expectTimeline(
      compile(`
length bars 4
track drums "Lofi breakbeat"

section intro:
    length bars 4
    bar 1:
        drums.play

intro()
`)
    );

    expect(timeline.musicalContext).toBeUndefined();
    expect('musicalContext' in timeline).toBe(false);
  });

  test('treats a bare section-level play as bar 1 of the section', () => {
    const timeline = expectTimeline(
      compile(`
length bars 8
track drums "Lofi breakbeat"

section intro:
    length bars 8
    drums.play
    bar 4:
        drums.stop

intro()
`)
    );

    expect(timeline.events).toEqual([
      expect.objectContaining({
        action: 'play',
        scope: 'timed',
        position: { bar: 1 },
        sectionInstanceId: 'section.intro.0'
      }),
      expect.objectContaining({
        action: 'stop',
        scope: 'timed',
        position: { bar: 4 },
        sectionInstanceId: 'section.intro.0'
      })
    ]);
  });

  describe('length forms', () => {
    test('finite', () => {
      const timeline = expectTimeline(
        compile(`
length bars 4
track drums "d"
section intro:
    length bars 4
    bar 1:
        drums.play
intro()
`)
      );
      expect(timeline.playback).toEqual({ mode: 'finite', declaredBars: 4 });
      expect(timeline.arrangedBars).toBe(4);
    });

    test('loop', () => {
      const timeline = expectTimeline(
        compile(`
length bars 4 loop
track drums "d"
section intro:
    length bars 4
    bar 1:
        drums.play
intro()
`)
      );
      expect(timeline.playback).toEqual({ mode: 'loop', declaredBars: 4 });
    });

    test('infinite with section-local length', () => {
      const timeline = expectTimeline(
        compile(`
length infinite
track drums "d"
section drone:
    length bars 4
    bar 1:
        drums.play
drone()
`)
      );
      expect(timeline.playback).toEqual({ mode: 'infinite' });
      expect(timeline.arrangedBars).toBe(4);
      expect(timeline.arrangement[0]).toMatchObject({ start: { bar: 1 }, end: { bar: 5 } });
    });

    test('infinite without a resolvable section length fails to compile', () => {
      const result = compile(`
length infinite
track drums "d"
section drone:
    bar 1:
        drums.play
drone()
`);
      expect(result.ok).toBe(false);
      expect(codes(result)).toContain('missing-section-length');
      expect(result.timeline).toBeUndefined();
    });
  });

  test('carries opaque alda source verbatim for notes and motif', () => {
    const timeline = expectTimeline(
      compile(`
tempo 120
length bars 4
track keys "Juno keys"
keys.motif alda(
    o3 g a b
)

section intro:
    length bars 4
    bar 1:
        keys.play

intro()
`)
    );

    const motif = timeline.tracks[0]?.defaults[0];
    expect(motif?.action).toBe('motif');
    expect(motif?.value.kind).toBe('alda');
    if (motif?.value.kind !== 'alda') {
      throw new Error('Expected an alda value.');
    }
    expect(motif.value.source).toBe('\n    o3 g a b\n');
    expect(motif.value.source).not.toContain('alda(');
  });

  test('returns no timeline when the document has errors', () => {
    const result = compile(`
track drums "Lofi breakbeat"

section intro:
    bar 1:
        drums.play

intro()
`);
    expect(result.ok).toBe(false);
    expect(result.timeline).toBeUndefined();
    expect(codes(result)).toContain('missing-length');
  });

  test('is deterministic', () => {
    const first = expectTimeline(compile(FULL_DOCUMENT));
    const second = expectTimeline(compile(FULL_DOCUMENT));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test('emits no seconds, timestamps, or durations', () => {
    const timeline = expectTimeline(compile(FULL_DOCUMENT));
    const serialized = JSON.stringify(timeline);
    for (const forbidden of ['seconds', 'timestamp', 'duration', 'millis', 'wallClock']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
