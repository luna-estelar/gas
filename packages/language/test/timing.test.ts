import { describe, expect, test } from 'vitest';
import { compileSource, type Timeline } from '../src/index.js';

// These tests cover musical-time positioning only. There are no seconds in a
// compiled timeline — bars→seconds conversion is Renderer-owned.

function compile(source: string): Timeline {
  const result = compileSource(source);
  if (!result.ok) {
    throw new Error(
      `Expected a timeline, got: ${result.diagnostics.map((d) => d.code).join(', ')}`
    );
  }
  return result.timeline;
}

describe('GAS musical-time placement', () => {
  test('concatenates sections and maps bar blocks to absolute bars', () => {
    const timeline = compile(`
length bars 12
track drums "d"

section a:
    length bars 4
    bar 1:
        drums.play
    bar 3:
        drums.stop

section b:
    length bars 8
    bar 1:
        drums.play

a()
b()
`);

    expect(timeline.arrangement).toEqual([
      expect.objectContaining({
        sectionInstanceId: 'section.a.0',
        start: { bar: 1 },
        end: { bar: 5 }
      }),
      expect.objectContaining({
        sectionInstanceId: 'section.b.1',
        start: { bar: 5 },
        end: { bar: 13 }
      })
    ]);
    expect(timeline.arrangedBars).toBe(12);

    // a.bar3 → absolute bar 3; b.bar1 → absolute bar 5.
    const positions = timeline.events.map((event) => ({
      action: event.action,
      bar: event.position.bar
    }));
    expect(positions).toEqual([
      { action: 'play', bar: 1 },
      { action: 'stop', bar: 3 },
      { action: 'play', bar: 5 }
    ]);
  });

  test('uses half-open [start, end) instance ranges', () => {
    const timeline = compile(`
length bars 8
track drums "d"

section a:
    length bars 8
    bar 1:
        drums.play

a()
`);
    expect(timeline.arrangement[0]).toMatchObject({ start: { bar: 1 }, end: { bar: 9 } });
  });

  test('lets a section-local length override the global length for placement', () => {
    const timeline = compile(`
length bars 8
track drums "d"

section a:
    length bars 2
    bar 1:
        drums.play

a()
`);
    // Placement follows the section-local length (2), not the global length (8).
    expect(timeline.arrangedBars).toBe(2);
    expect(timeline.arrangement[0]).toMatchObject({ start: { bar: 1 }, end: { bar: 3 } });
  });

  test('advances the cursor across repeated calls of the same section', () => {
    const timeline = compile(`
length bars 8
track drums "d"

section a:
    length bars 4
    bar 1:
        drums.play

a()
a()
`);

    expect(timeline.arrangement.map((instance) => instance.sectionInstanceId)).toEqual([
      'section.a.0',
      'section.a.1'
    ]);
    expect(timeline.arrangement.map((instance) => instance.start.bar)).toEqual([1, 5]);
    expect(
      timeline.events.map((event) => ({
        bar: event.position.bar,
        instance: event.sectionInstanceId
      }))
    ).toEqual([
      { bar: 1, instance: 'section.a.0' },
      { bar: 5, instance: 'section.a.1' }
    ]);
    expect(timeline.arrangedBars).toBe(8);
  });
});
