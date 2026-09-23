# Changelog

All notable changes to GAS are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

All ten packages share one version and are released together.

## [0.1.1]

### Fixed

- **`@luna-estelar/gas-protocol`** — the canonical timeline validator is precompiled at build
  time instead of being built with AJV when the module is imported. Importing the protocol
  validator, Core, the Renderer or a browser session generated code at runtime, which a
  Content Security Policy without `'unsafe-eval'` blocks, so no deployed page could start a
  session. Validation behaviour and reported problems are unchanged.
- **`@luna-estelar/gas-renderer`** — a session no longer compiles the connector's
  configuration schema at startup. The connector contract check it performed is now opt-in
  through `checkConnectorContract`, and the schema is compiled on the first
  `updateConnectorConfig` call.

## [0.1.0]

First public preview. Package APIs may change in minor releases before 1.0.

### Added

- **`@luna-estelar/gas-language`** — parses, validates and compiles GAS documents and
  live fragments into model-independent timelines in musical time.
- **`@luna-estelar/gas-protocol`** — the transport-neutral contracts every other package
  shares, with Draft 2020-12 JSON Schemas for the Protocol 1.0 value families.
- **`@luna-estelar/gas-core`** — pure session semantics: input state, the canonical
  command set, the effective-state cascade, and the playback transition rules.
- **`@luna-estelar/gas-renderer`** — the clock-driven scheduler, musical-to-clock
  conversion, and connector lifecycle.
- **`@luna-estelar/gas-api`** — the application-facing session surface.
- **`@luna-estelar/gas-browser`** — the framework-free browser host, as explicit subpaths
  with no root barrel.
- **`@luna-estelar/gas-connector-lyria`** — the Lyria RealTime boundary: prompt
  translation, transport, and capability reporting.
- **`@luna-estelar/gas-notation`** — the minimal Alda subset and MIDI encoding.
- **`@luna-estelar/gas-highlight`** — syntax-presentation helpers, depending on the
  language package type-only so it never loads the parser.
- **`@luna-estelar/gas-cli`** — the `gas` command.

### Known limitations

- Lyria is the only connector.
- Lyria supports `flavor`, `tempo` and `timbre`, and approximates `key` and `level`.
- `time_signature`, `notes` and `motif` compile and remain in session state, but Lyria
  cannot render them. GAS reports a capability warning rather than dropping them.

[Unreleased]: https://github.com/luna-estelar/gas/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/luna-estelar/gas/releases/tag/v0.1.1
[0.1.0]: https://github.com/luna-estelar/gas/releases/tag/v0.1.0
