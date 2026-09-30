// gas-highlight declares HighlightKind itself rather than importing it from the
// language package, which removed the compile-time check that TOKEN_CLASS covers
// every kind the compiler emits: nothing typechecks this directory, and an
// unknown kind now yields undefined at runtime instead of failing the build.
// These cases hold the parity the two packages' READMEs promise.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exampleFiles, readExample } from '../examples/support.js';
import { TOKEN_CLASS, toLines } from '../packages/highlight/src/index.js';
import { highlightSource } from '../packages/language/src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The kinds the language package's HighlightKind union declares. */
function declaredKinds(): string[] {
  const source = readFileSync(
    path.join(root, 'packages', 'language', 'src', 'highlight.ts'),
    'utf8'
  );
  const union = /export type HighlightKind =([^;]+);/.exec(source);
  if (union === null) throw new Error('HighlightKind union not found in the language package');
  return [...union[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!).sort();
}

describe('highlight token parity', () => {
  it('classifies exactly the kinds the language package declares', () => {
    const declared = declaredKinds();
    // A regex that matched nothing would make this pass without comparing.
    expect(declared.length).toBeGreaterThan(1);
    expect(Object.keys(TOKEN_CLASS).sort()).toEqual(declared);
  });

  it('classifies every kind the compiler emits across the corpus', () => {
    const files = exampleFiles();
    const unclassified = new Set<string>();
    let seen = 0;

    for (const file of files) {
      const source = readExample(file);
      const { tokens } = highlightSource(source);
      seen += tokens.length;
      for (const token of tokens) {
        if (!(token.kind in TOKEN_CLASS)) unclassified.add(token.kind);
      }

      // Spans must reconstruct the source, which only holds while from and to
      // mean what highlight assumes. toLines drops one trailing newline.
      const rebuilt = toLines(source, tokens)
        .map((line) => line.map((span) => span.text).join(''))
        .join('\n');
      expect(rebuilt, file).toBe(source.replace(/\n$/, ''));
    }

    expect(seen).toBeGreaterThan(0);
    expect([...unclassified]).toEqual([]);
  });
});
