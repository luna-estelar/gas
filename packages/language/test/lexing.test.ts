import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { createGasServices } from '../src/gas-module.js';
import { scanAlda } from '../src/gas-token-builder.js';

let services: ReturnType<typeof createGasServices>;

beforeAll(() => {
  services = createGasServices(EmptyFileSystem);
});

describe('GAS lexing', () => {
  test('scans balanced ALDA snippets', () => {
    const source = 'alda(\n    o3\n    (tempo! 90)\n)';

    expect(scanAlda(source, 0)).toBe(source);
    expect(scanAlda('x' + source, 1)).toBe(source);
    expect(scanAlda('alda((tempo! 90)', 0)).toBeUndefined();
    expect(scanAlda('notes "not alda"', 0)).toBeUndefined();
  });

  test('emits indentation tokens for a section body', () => {
    const result = services.Gas.parser.Lexer.tokenize(`
section chorus:
    length bars 8
`);

    expect(result.errors).toHaveLength(0);
    expect(tokenNames(result.tokens)).toEqual([
      'section',
      'ID',
      ':',
      'INDENT',
      'length',
      'bars',
      'INT',
      'DEDENT'
    ]);
  });

  test('emits nested indentation tokens for a section bar', () => {
    const result = services.Gas.parser.Lexer.tokenize(`
track drums "Lofi breakbeat"
section chorus:
    bar 1:
        drums.play
`);

    expect(result.errors).toHaveLength(0);
    expect(tokenNames(result.tokens)).toEqual([
      'track',
      'ID',
      'STRING',
      'section',
      'ID',
      ':',
      'INDENT',
      'bar',
      'INT',
      ':',
      'INDENT',
      'ID',
      '.',
      'play',
      'DEDENT',
      'DEDENT'
    ]);
  });

  test('ignores comments and blank lines inside indented bodies', () => {
    const result = services.Gas.parser.Lexer.tokenize(`
section chorus:
    bar 1:
        drums.play
    # comment between bars

    bar 2:
        drums.stop
`);

    expect(result.errors).toHaveLength(0);
    expect(tokenNames(result.tokens)).toEqual([
      'section',
      'ID',
      ':',
      'INDENT',
      'bar',
      'INT',
      ':',
      'INDENT',
      'ID',
      '.',
      'play',
      'DEDENT',
      'bar',
      'INT',
      ':',
      'INDENT',
      'ID',
      '.',
      'stop',
      'DEDENT',
      'DEDENT'
    ]);
  });

  test('reports inconsistent mixed indentation', () => {
    const result = services.Gas.parser.Lexer.tokenize(
      'section chorus:\n    length bars 8\n\tflavor "x"\n'
    );

    expect(result.errors.length + (result.report?.diagnostics.length ?? 0)).toBeGreaterThan(0);
  });

  test('emits one token for ALDA snippets with nested parens', () => {
    const result = services.Gas.parser.Lexer.tokenize(`track keys "Juno"
keys.motif alda(
    o3
    (tempo! 90)
)
`);

    expect(result.errors).toHaveLength(0);
    expect(tokenNames(result.tokens).filter((name) => name === 'ALDA')).toHaveLength(1);
  });

  test('reports unterminated ALDA snippets', () => {
    const result = services.Gas.parser.Lexer.tokenize(
      'track keys "Juno"\nkeys.motif alda(\n    o3\n'
    );

    expect(result.errors.length + (result.report?.diagnostics.length ?? 0)).toBeGreaterThan(0);
  });
});

function tokenNames(tokens: Array<{ tokenType: { name: string } }>): string[] {
  return tokens.map((token) => token.tokenType.name);
}
