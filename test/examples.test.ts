// Check example compilation, highlighting and manifest metadata.
import { describe, expect, it } from 'vitest';
import { compileGas } from '@luna-estelar/gas-browser/compile';
import { deriveTimeline } from '@luna-estelar/gas-browser/timeline';
import { TOKEN_CLASS, toLines } from '../packages/highlight/src/index.js';
import { EXAMPLES } from '../examples/manifest.js';
import { readExample } from '../examples/support.js';

describe.each(EXAMPLES)('$name.gas', ({ name, mode, bars, tempo }) => {
  const source = readExample(name);
  const snapshot = compileGas(source, `${name}.gas`);

  it('compiles with no diagnostics to report', () => {
    // Anything above `info` would render as a problem badge on the homepage.
    expect(snapshot.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    expect(snapshot.ok).toBe(true);
    expect(snapshot.timeline).toBeDefined();
  });

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

  it('highlights into lines that rejoin to the exact source', () => {
    const lines = toLines(source, snapshot.tokens);
    expect(lines.map((line) => line.map((span) => span.text).join('')).join('\n')).toBe(
      source.replace(/\n$/, '')
    );
    expect(lines).toHaveLength(source.replace(/\n$/, '').split('\n').length);
    for (const line of lines) {
      for (const span of line) expect(span.text).not.toContain('\n');
    }
  });

  it('classes every token it emits', () => {
    for (const token of snapshot.tokens) expect(TOKEN_CLASS[token.kind]).toBeDefined();
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

describe('spec-example.gas specifics', () => {
  const source = readExample('spec-example');
  const snapshot = compileGas(source, 'spec-example.gas');

  it('is the example that exercises all nine highlight kinds', () => {
    // This is why it is the island's default: whatever the highlighter gets
    // wrong is visible on first paint.
    expect(new Set(snapshot.tokens.map((token) => token.kind)).size).toBe(
      Object.keys(TOKEN_CLASS).length
    );
  });

  it('splits its multi-line alda motifs across lines', () => {
    // The two alda() blocks each arrive as ONE builtin token spanning four
    // lines. A renderer that emitted a span per token would put newlines inside
    // spans and break the per-line layout.
    const multiline = snapshot.tokens.filter((token) =>
      source.slice(token.from, token.to).includes('\n')
    );
    expect(multiline).toHaveLength(2);
    expect(multiline.every((token) => token.kind === 'builtin')).toBe(true);

    const lines = toLines(source, snapshot.tokens);
    const opening = lines.findIndex((line) => line.some((span) => span.text.endsWith('alda(')));
    expect(opening).toBeGreaterThanOrEqual(0);
    for (const line of lines.slice(opening + 1, opening + 4)) {
      expect(line.every((span) => span.cls === TOKEN_CLASS.builtin)).toBe(true);
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

  it('declares a homepage order with no gaps or repeats', () => {
    // Display order must be contiguous and unique. exampleFiles checks directory membership.
    const indices = EXAMPLES.flatMap((example) =>
      example.homepage === undefined ? [] : [example.homepage]
    ).sort((a, b) => a - b);
    expect(indices).toEqual(indices.map((_, position) => position));
  });
});
