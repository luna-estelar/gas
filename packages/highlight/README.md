# GAS Highlight

`@luna-estelar/gas-highlight` contains the pure presentation helpers shared by GAS documentation
and browser-facing renderers. The package maps compiler highlight tokens to syntax classes, splits
flat token ranges into per-line spans, and owns the supported GAS documentation-fence metadata.

## Install

```bash
npm install @luna-estelar/gas-highlight
```

The package is ESM-only and requires Node.js 22 or newer when used in Node because its declarations
refer to the language package. The emitted JavaScript itself is pure and browser-safe.

The package root exports `TOKEN_CLASS`, `toLines`, `Span`, `HighlightToken`,
`GAS_FENCE_LABELS`, `GAS_LANGS`, and `hasCodeFence`. Its dependency on
`@luna-estelar/gas-language` is type-only: the emitted JavaScript does not load the parser,
Langium, or Chevrotain.

```ts
import { toLines, type HighlightToken } from '@luna-estelar/gas-highlight';

declare const tokens: readonly HighlightToken[];

const lines = toLines('tempo 88', tokens);
console.log(lines[0]);
```
