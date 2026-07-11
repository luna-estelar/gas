# GAS

GAS (Generative Audio Syntax) is a language and runtime for directing generative audio models.
The workspace contains the library implementation and its tests.

## Packages

- `@luna-estelar/gas-api`: Application-facing JavaScript control surface for GAS source and programmatic commands.
- `@luna-estelar/gas-cli`: Command-line entrypoint for GAS.
- `@luna-estelar/gas-connector-lyria`: Model-specific Lyria boundary: prompt translation, transport, and config interpretation.
- `@luna-estelar/gas-core`: Pure GAS semantics: the session input state, command validation, and the effective-state cascade. Owns no clock, no I/O, and no instance state.
- `@luna-estelar/gas-language`: Parses, validates, and compiles GAS documents and live fragments into musical-time timelines.
- `@luna-estelar/gas-notation`: Pure GAS notation helpers for parsing minimal Alda and encoding standard MIDI files.
- `@luna-estelar/gas-protocol`: Shared, transport-neutral payload schemas and types used across the GAS packages.
- `@luna-estelar/gas-renderer`: Audio generation and playback: clock, scheduling, musical-to-clock conversion, and session state derived through gas-core.

## Development

Use Node >=22.13.0 and pnpm@11.1.2.

```bash
pnpm install --frozen-lockfile
pnpm test
```

Package tests follow their package dependency boundaries. Root tests cover integration between packages.

[Documentation](https://gas.lunaestelar.com/docs) is maintained separately.

[MIT license](./LICENSE).
