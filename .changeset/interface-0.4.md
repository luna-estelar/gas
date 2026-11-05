---
'@luna-estelar/gas': minor
'@luna-estelar/gas-lyria-rt': minor
---

The 0.4 connector interface is in `@luna-estelar/gas/protocol`: `Connector` with `connect()`, and
`Connection` with `update`, `pause`, `resume` and `close`. `ConnectorTiming` gains
`quarterNoteTempo`.

`RendererDefaults` is now `DocumentDefaults`. `TrackView.source` is `'document'` or `'app'`.

`GasOperationError.kind` is one of `document`, `command`, `state`, `provider` or `cancelled`.
