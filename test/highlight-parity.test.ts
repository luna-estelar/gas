// The highlight module declares its token kinds itself, so check they match what the compiler emits.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exampleFiles, readExample } from '../examples/support.js';
import { TOKEN_CLASS, toLines } from '../packages/gas/src/highlight/index.js';
import { highlightSource } from '../packages/gas/src/language/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The kinds the language module's HighlightKind union declares. */
function declaredKinds(): string[] {
  const source = readFileSync(
    path.join(root, 'packages', 'gas', 'src', 'language', 'highlight.ts'),
    'utf8'
  );
  const union = /export type HighlightKind =([^;]+);/.exec(source);
  if (union === null) throw new Error('HighlightKind union not found in the language module');
  return [...union[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!).sort();
}

describe('highlight token parity', () => {
  it('classifies exactly the kinds the language package declares', () => {
    const declared = declaredKinds();
    // A regex that matched nothing would make this pass without comparing.
    expect(declared.length).toBeGreaterThan(1);
    expect(Object.keys(TOKEN_CLASS).sort()).toEqual(declared);
  });

  it.each(exampleFiles())('%s renders classified spans that reconstruct its source', (file) => {
    const source = readExample(file);
    const { tokens } = highlightSource(source);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) expect(TOKEN_CLASS[token.kind]).toBeDefined();

    // toLines drops exactly one trailing newline.
    const lines = toLines(source, tokens);
    const displayedSource = source.replace(/\n$/, '');
    expect(lines.map((line) => line.map((span) => span.text).join('')).join('\n')).toBe(
      displayedSource
    );
    expect(lines).toHaveLength(displayedSource.split('\n').length);
    for (const line of lines) {
      for (const span of line) expect(span.text).not.toContain('\n');
    }
  });

  it('exercises every highlight kind in spec-example.gas', () => {
    const { tokens } = highlightSource(readExample('spec-example'));
    expect(new Set(tokens.map((token) => token.kind)).size).toBe(Object.keys(TOKEN_CLASS).length);
  });
});
