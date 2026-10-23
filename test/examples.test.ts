// Check example metadata and browser timeline integration; compilation belongs to the corpus suite.
import { describe, expect, it } from 'vitest';
import { compileGas } from '../packages/gas/src/editor/index.js';
import { deriveTimeline } from '../packages/gas/src/browser/timeline.js';
import { toLines } from '../packages/gas/src/highlight/index.js';
import { EXAMPLES } from '../examples/manifest.js';
import { readExample } from '../examples/support.js';

describe.each(EXAMPLES)('$name.gas', ({ name, mode, bars, tempo }) => {
  const source = readExample(name);
  const snapshot = compileGas(source, `${name}.gas`);

  it('carries the playback shape the site copy claims', () => {
    expect(snapshot.timeline?.playback.mode).toBe(mode);
    expect(snapshot.timeline?.arrangedBars).toBe(bars);
  });

  it('derives a timeline with sections, events, and a meta line', () => {
    const view = deriveTimeline(snapshot.timeline!);
    expect(view.sections.length).toBeGreaterThanOrEqual(1);
    expect(view.events.length).toBeGreaterThanOrEqual(1);
    expect(view.meta).toContain(`${tempo} bpm`);
    // Sections tile the strip: the widths are percentages that must add to 100.
    const total = view.sections.reduce((sum, section) => sum + section.width, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it('places every event source line inside the highlighted document', () => {
    // sourceLine is a zero-based line index (LSP convention, same as the
    // diagnostic ranges), which is what makes it usable directly as an index
    // into toLines() output to light up the bar currently playing.
    const lines = toLines(source, snapshot.tokens);
    for (const event of deriveTimeline(snapshot.timeline!).events) {
      if (event.sourceLine === undefined) continue;
      expect(event.sourceLine).toBeGreaterThanOrEqual(0);
      expect(event.sourceLine).toBeLessThan(lines.length);
    }
  });
});

describe('the shipped set', () => {
  it('covers all three playback modes', () => {
    // The examples cover finite, loop and infinite playback.
    expect(new Set(EXAMPLES.map((example) => example.mode))).toEqual(
      new Set(['finite', 'loop', 'infinite'])
    );
  });
});
