---
'@luna-estelar/gas-protocol': minor
---

Failures now carry `closeCode`, the raw transport close code, from `ConnectorError` through
`RendererFailure` to the host. `isCloseCode` is the single gate on it — a whole number from 1000
through 4999 — used by the error constructor, the structural guard and the JSON Schema range
alike, so a code that reaches a host is always in range or absent. A connector classifies the
standard codes into a `reason` and leaves the application range 4000-4999 for the host to map.

A finite piece that reaches its declared length now says so: `RendererStatusEvent` and
`LifecycleEvent` gain `completed`. `stream` keeps meaning provider stream state only, so a
provider that ends its stream early is no longer mistaken for a piece that finished.

Connectors now own validating their own configuration. `Connector.validateConfig` returns a
`ConnectorConfigValidation` — either `{ ok: true }` or a list of `ConnectorConfigProblem` — so no
Renderer has to compile a connector's schema and a session stays usable under a Content Security
Policy without `'unsafe-eval'`. The problem shape is a JSON Pointer `path`, a stable `code` and a
fixed safe `message`, not an imitation of a schema compiler's output.

`Renderer.positionAtSeconds` is a new optional method returning the musical position a given
number of seconds after the current run's anchor, so a host can place what a listener is actually
hearing rather than where generation has reached.

Timeline validation gains four problem codes for invariants the schema cannot express:
`events-unordered`, `sequence-collision`, `beat-out-of-range` and `event-outside-section`.

Protocol JSON stays at version 1.0: every schema change is additive and optional.
