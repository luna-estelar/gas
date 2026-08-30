# GAS Highlight

`@luna-estelar/gas-highlight` contains the pure presentation helpers shared by GAS documentation
and browser-facing renderers. The package maps compiler highlight tokens to syntax classes, splits
flat token ranges into per-line spans, and owns the supported GAS documentation-fence metadata.

The package root exports `TOKEN_CLASS`, `toLines`, `Span`, `HighlightToken`,
`GAS_FENCE_LABELS`, `GAS_LANGS`, and `hasCodeFence`. Its dependency on
`@luna-estelar/gas-language` is type-only: the emitted JavaScript does not load the parser,
Langium, or Chevrotain.
