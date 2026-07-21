import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { highlightSource } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusRoot = path.join(here, 'corpus');

describe('GAS editor highlighting', () => {
  test.each(
    readdirSync(corpusRoot)
      .filter((name) => name.endsWith('.gas'))
      .sort()
  )('%s returns sorted, in-range tokens', (name) => {
    const source = readFileSync(path.join(corpusRoot, name), 'utf8');
    const result = highlightSource(source);
    expect(result.tokens.length).toBeGreaterThan(0);
    for (const [index, token] of result.tokens.entries()) {
      expect(token.from).toBeGreaterThanOrEqual(0);
      expect(token.to).toBeGreaterThan(token.from);
      expect(token.to).toBeLessThanOrEqual(source.length);
      if (index > 0) expect(token.from).toBeGreaterThanOrEqual(result.tokens[index - 1]!.to);
    }
  });

  test('finds track and section declarations and references', () => {
    const source = readFileSync(path.join(corpusRoot, 'spec-example.gas'), 'utf8');
    const symbols = highlightSource(source).symbols;
    expect(symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'track', role: 'declaration', name: 'guitar' }),
        expect.objectContaining({ kind: 'track', role: 'reference', name: 'guitar' }),
        expect.objectContaining({ kind: 'section', role: 'declaration', name: 'chorus' }),
        expect.objectContaining({ kind: 'section', role: 'reference', name: 'chorus' })
      ])
    );
  });

  test('keeps partial tokens and comments in a broken document', () => {
    const source = 'track pad "warm # glow" # real comment\nsection intro:\n    pad.';
    const result = highlightSource(source);
    expect(
      result.tokens.some(
        (token) =>
          token.kind === 'comment' && source.slice(token.from, token.to) === '# real comment'
      )
    ).toBe(true);
    expect(result.tokens.some((token) => token.kind === 'track')).toBe(true);
  });
});
