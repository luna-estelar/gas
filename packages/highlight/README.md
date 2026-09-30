# @luna-estelar/gas-highlight

Pure presentation helpers for GAS source: syntax classes for compiler highlight tokens, per-line
spans, and the supported documentation-fence metadata. It presents the document stage of
`document → language → timeline → session → renderer → connector → model` without loading the
parser.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-highlight)](https://www.npmjs.com/package/@luna-estelar/gas-highlight)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas-highlight)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/ci.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/ci.yml)

## Install

```bash
npm install @luna-estelar/gas-highlight
```

Part of `@luna-estelar/gas`, which installs every package; there it is the `/highlight` subpath.

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
- Node.js 22 or newer when used in Node, matching the baseline across these packages; runs in
  browsers.
- Pure and browser-safe, with no dependencies.

## Related packages

Depends on nothing. Pairs with `@luna-estelar/gas-language`, whose `highlightSource` produces the
tokens; installing this package pulls in neither the parser, Langium, nor Chevrotain.

## License

MIT
