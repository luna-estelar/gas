// Test highlighter line splitting without loading the compiler.
import { describe, expect, it } from 'vitest';
import { TOKEN_CLASS, toLines, type HighlightToken } from '../src/index.js';

/** Find token offsets in the source text. */
function token(source: string, text: string, kind: HighlightToken['kind']): HighlightToken {
  const from = source.indexOf(text);
  if (from === -1) throw new Error(`fixture error: ${text} not in source`);
  return { from, to: from + text.length, kind };
}

const text = (spans: readonly { readonly text: string }[]): string =>
  spans.map((span) => span.text).join('');

describe('toLines', () => {
  it('classes tokens and leaves the gaps between them unclassed', () => {
    const source = 'tempo 104';
    const lines = toLines(source, [
      token(source, 'tempo', 'keyword'),
      token(source, '104', 'number')
    ]);
    expect(lines).toEqual([
      [{ cls: 't-kw', text: 'tempo' }, { text: ' ' }, { cls: 't-num', text: '104' }]
    ]);
  });

  it('splits a token that spans several lines, keeping its class on each piece', () => {
    // The reason this function exists: alda() blocks arrive as one token whose
    // text contains newlines. Every emitted span must be newline-free.
    const source = 'x.motif alda(\n  o4\n  c8 d\n)\n';
    const lines = toLines(source, [token(source, 'alda(\n  o4\n  c8 d\n)', 'builtin')]);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toEqual([{ cls: 't-type', text: '  o4' }]);
    expect(lines[3]).toEqual([{ cls: 't-type', text: ')' }]);
    for (const line of lines) {
      for (const span of line) expect(span.text).not.toContain('\n');
    }
  });

  it('reproduces the source exactly when the spans are rejoined', () => {
    const source = '# c\ntrack a "b"\n\nsection s:\n    a.play\n';
    const lines = toLines(source, [
      token(source, '# c', 'comment'),
      token(source, 'track', 'keyword'),
      token(source, '"b"', 'string'),
      token(source, 'section', 'keyword'),
      token(source, 'play', 'action')
    ]);
    expect(lines.map(text).join('\n')).toBe(source.replace(/\n$/, ''));
  });

  it('keeps interior blank lines as empty span lists', () => {
    const lines = toLines('a\n\nb\n', []);
    expect(lines).toEqual([[{ text: 'a' }], [], [{ text: 'b' }]]);
  });

  it('drops exactly one trailing newline', () => {
    expect(toLines('a\n', [])).toHaveLength(1);
    expect(toLines('a\n\n', [])).toHaveLength(2);
    expect(toLines('a', [])).toHaveLength(1);
  });

  it('renders an empty source as a single empty line', () => {
    expect(toLines('', [])).toEqual([[]]);
  });

  it('tolerates unsorted tokens without garbling the source', () => {
    const source = 'tempo 104';
    const forward = toLines(source, [
      token(source, 'tempo', 'keyword'),
      token(source, '104', 'number')
    ]);
    const reversed = toLines(source, [
      token(source, '104', 'number'),
      token(source, 'tempo', 'keyword')
    ]);
    expect(reversed).toEqual(forward);
  });

  it('drops an overlapping token rather than duplicating the text', () => {
    const source = 'tempo 104';
    const lines = toLines(source, [
      { from: 0, to: 9, kind: 'keyword' },
      { from: 6, to: 9, kind: 'number' }
    ]);
    expect(text(lines[0]!)).toBe(source);
  });
});

describe('TOKEN_CLASS', () => {
  it('maps every configured highlight kind to a syntax class', () => {
    for (const className of Object.values(TOKEN_CLASS)) {
      expect(className).toMatch(/^t-[a-z]+$/);
    }
  });
});
