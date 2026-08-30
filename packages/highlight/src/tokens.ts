// Turns the compiler's flat token list into per-line spans, ready to render as
// HTML. Pure and dependency-free (the language imports are type-only), so the
// same function runs at build time and in the browser with identical output.
import type { HighlightKind, HighlightToken } from '@luna-estelar/gas-language';

export type { HighlightToken };

/** Syntax classes for compiler highlight kinds. Consumers provide matching CSS. */
export const TOKEN_CLASS: Record<HighlightKind, string> = {
  keyword: 't-kw',
  action: 't-fn',
  builtin: 't-type',
  section: 't-type',
  track: 't-var',
  string: 't-str',
  number: 't-num',
  punct: 't-op',
  comment: 't-com'
};

/** One run of characters on one line, optionally carrying a syntax class. */
export interface Span {
  readonly cls?: string;
  readonly text: string;
}

/**
 * Split tokens into newline-free spans, preserving unclassified gaps.
 * Multiline tokens are split at each line boundary; one trailing newline is dropped.
 */
export function toLines(code: string, tokens: readonly HighlightToken[]): Span[][] {
  const lines: Span[][] = [[]];

  const push = (text: string, cls?: string): void => {
    let start = 0;
    for (;;) {
      const newline = text.indexOf('\n', start);
      const chunk = text.slice(start, newline === -1 ? undefined : newline);
      if (chunk !== '') {
        lines[lines.length - 1]!.push(cls === undefined ? { text: chunk } : { cls, text: chunk });
      }
      if (newline === -1) return;
      lines.push([]);
      start = newline + 1;
    }
  };

  // Sort tokens and skip consumed ranges to tolerate unordered or overlapping input.
  const ordered = [...tokens].sort((a, b) => a.from - b.from);
  let cursor = 0;
  for (const token of ordered) {
    if (token.to <= cursor) continue;
    const from = Math.max(cursor, token.from);
    if (from > cursor) push(code.slice(cursor, from));
    push(code.slice(from, token.to), TOKEN_CLASS[token.kind]);
    cursor = token.to;
  }
  if (cursor < code.length) push(code.slice(cursor));

  if (lines.length > 1 && lines[lines.length - 1]!.length === 0 && code.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}
