---
'@luna-estelar/gas-protocol': minor
---

`ConnectorError` now accepts an optional `closeCode`, and `RendererFailure` gains the matching
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
