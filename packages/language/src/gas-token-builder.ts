import { createToken } from 'chevrotain';
import { IndentationAwareTokenBuilder } from 'langium';
import type { GrammarAST } from 'langium';
import type { GasKeywordNames, GasTerminalNames } from './generated/ast.js';

export class GasTokenBuilder extends IndentationAwareTokenBuilder<
  GasTerminalNames,
  GasKeywordNames
> {
  constructor() {
    super({
      indentTokenName: 'INDENT',
      dedentTokenName: 'DEDENT',
      whitespaceTokenName: 'WS'
    });
  }

  protected override buildTerminalToken(terminal: GrammarAST.TerminalRule) {
    if (terminal.name === 'ALDA') {
      return createToken({
        name: 'ALDA',
        pattern: {
          exec: (text: string, offset: number) => {
            const result = scanAldaToken(text, offset);
            if (result === undefined) {
              return null;
            }
            if (result.unterminated) {
              this.diagnostics.push({
                severity: 'error',
                message: 'Unterminated ALDA snippet.',
                offset,
                length: result.image.length,
                line: getLine(text, offset),
                column: getColumn(text, offset)
              });
            }
            const match = [result.image] as RegExpExecArray;
            match.index = offset;
            match.input = text;
            return match;
          }
        },
        line_breaks: true,
        start_chars_hint: ['a']
      });
    }
    return super.buildTerminalToken(terminal);
  }
}

export function scanAlda(text: string, offset: number): string | undefined {
  const result = scanAldaToken(text, offset);
  return result?.unterminated ? undefined : result?.image;
}

function scanAldaToken(
  text: string,
  offset: number
): { image: string; unterminated: boolean } | undefined {
  const prefix = 'alda(';
  if (!text.startsWith(prefix, offset)) {
    return undefined;
  }

  let depth = 1;
  let index = offset + prefix.length;

  while (index < text.length) {
    const char = text[index];
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        return { image: text.slice(offset, index + 1), unterminated: false };
      }
    }
    index++;
  }

  return { image: text.slice(offset), unterminated: true };
}

function getLine(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r\n|\r|\n/).length;
}

function getColumn(text: string, offset: number): number {
  const lineStart = Math.max(
    text.lastIndexOf('\n', offset - 1),
    text.lastIndexOf('\r', offset - 1)
  );
  return offset - lineStart;
}
