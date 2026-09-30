# @luna-estelar/gas-protocol

## 0.2.0

### Minor Changes

- [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2) Thanks [@sathira10](https://github.com/sathira10)! - `ConnectorError` now accepts an optional `closeCode`, and `RendererFailure` gains the matching
  field. `isCloseCode` accepts a whole number from 1000 through 4999; the error constructor,
  structural guard and JSON Schema enforce that range. This prepares the failure contract for
  forwarding the raw transport code to hosts, which can map the application range 4000-4999.

  `RendererStatusEvent` and `LifecycleEvent` gain an optional `completed: true` field for finite
  completion. `stream` continues to describe provider stream state.

  The optional `Connector.validateConfig` method returns a `ConnectorConfigValidation` — either
  `{ ok: true }` or `{ ok: false, problems }` — for connector-owned validation without runtime
  schema compilation. Each `ConnectorConfigProblem` contains a JSON Pointer `path`, a stable `code`
  and a fixed safe `message`.

  The optional `Renderer.positionAtSeconds` contract maps seconds after the current run's anchor
  to a musical position for an audible playhead.

  Runtime forwarding of close codes, completion handling, configuration validation through the
  connector, and the playhead method follow in subsequent Renderer, connector and API updates.

  Timeline validation gains four problem codes for invariants the schema cannot express:
  `events-unordered`, `sequence-collision`, `beat-out-of-range` and `event-outside-section`.

  Protocol JSON stays at version 1.0: every schema change is additive and optional.

### Patch Changes

- [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439) Thanks [@sathira10](https://github.com/sathira10)! - Internal dependency ranges widened to caret, so each package can be released on its own.

## 0.1.1

### Patch Changes

- The canonical timeline validator is precompiled at build time instead of being built
  with AJV when the module is imported. Importing the protocol validator, Core, the
  Renderer or a browser session generated code at runtime, which a Content Security Policy
  without `'unsafe-eval'` blocks, so no deployed page could start a session. Validation
  behaviour and reported problems are unchanged.

## 0.1.0

### Minor Changes

- First public preview. The transport-neutral contracts every other package shares, with
  Draft 2020-12 JSON Schemas for the Protocol 1.0 value families. Package APIs may change
  in minor releases before 1.0.
