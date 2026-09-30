# GAS Highlight

`@luna-estelar/gas-highlight` contains the pure presentation helpers shared by GAS documentation
and browser-facing renderers. The package maps compiler highlight tokens to syntax classes, splits
flat token ranges into per-line spans, and owns the supported GAS documentation-fence metadata.

## Install

```bash
npm install @luna-estelar/gas-highlight
```

The package is ESM-only and requires Node.js 22 or newer when used in Node, matching the
baseline across these packages. It has no dependencies, and both the declarations and the emitted
JavaScript are pure and browser-safe.

The package root exports `TOKEN_CLASS`, `toLines`, `Span`, `HighlightToken`,
`GAS_FENCE_LABELS`, `GAS_LANGS`, and `hasCodeFence`. It declares `HighlightToken` itself
rather than depending on `@luna-estelar/gas-language`, so installing it pulls in neither the
parser, Langium, nor Chevrotain. The type is structural, so tokens from the language package's
`highlightSource` pass straight into `toLines`.

```ts
import { toLines, type HighlightToken } from '@luna-estelar/gas-highlight';

declare const tokens: readonly HighlightToken[];

const lines = toLines('tempo 88', tokens);
console.log(lines[0]);
```
