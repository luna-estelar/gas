---
'@luna-estelar/gas': minor
'@luna-estelar/gas-lyria-rt': minor
---

The 0.4 connector interface is in `@luna-estelar/gas/protocol`: `Connector` with `connect()`, and
`Connection` with `update`, `pause`, `resume` and `close`. `ConnectorTiming` gains
`quarterNoteTempo`. `ModelInfo` gains an optional `startupDelaySeconds`, and GAS resumes the model
that much plus one chunk before a track comes in after a rest.

`RendererDefaults` is now `DocumentDefaults`. `TrackView.source` is `'document'` or `'app'`.

`GasOperationError.kind` is one of `document`, `command`, `state`, `provider` or `cancelled`.
