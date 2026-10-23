# @luna-estelar/gas-highlight

Syntax highlighting for GAS source and `gas` code fences in your docs. It turns highlight tokens
into per-line spans with CSS classes, and it never loads the parser.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-highlight)](https://www.npmjs.com/package/@luna-estelar/gas-highlight)

## Install

```bash
npm install @luna-estelar/gas-highlight
```

Also included in `@luna-estelar/gas` as `@luna-estelar/gas/highlight`.

## Example

```ts
import { toLines, type HighlightToken } from '@luna-estelar/gas-highlight';

const code = 'tempo 88';
const tokens: readonly HighlightToken[] = [
  { from: 0, to: 5, kind: 'keyword' },
  { from: 6, to: 8, kind: 'number' }
];

// Each span carries its syntax class (`t-kw`, `t-num`, …); gaps have none.
for (const span of toLines(code, tokens)[0] ?? []) console.log(span.cls, span.text);
```

## Exports

| Export                   | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `TOKEN_CLASS`            | The syntax class for each highlight kind; consumers supply matching CSS |
| `toLines`                | Split flat token ranges into newline-free spans, one array per line     |
| `HighlightToken`, `Span` | The token and span types                                                |
| `GAS_FENCE_LABELS`       | Display labels for `gas`, `gas-live` and `gas-fragment` fences          |
| `GAS_LANGS`              | The same fence languages, for a highlighter such as Shiki to skip       |
| `hasCodeFence`           | Whether Markdown source contains a fenced code block                    |

`HighlightToken` is declared here rather than imported from `@luna-estelar/gas-language`. The type
is structural, so tokens from the language package's `highlightSource` pass straight into
`toLines`.

## Runtime support

- ESM-only.
- Node.js 22 or newer when used in Node; runs in browsers.
- No dependencies.

## Related packages

Pair it with `@luna-estelar/gas-language`, whose `highlightSource` produces the tokens. This
package does not pull in the parser.

## License

MIT
