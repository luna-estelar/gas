---
'@luna-estelar/gas': minor
'@luna-estelar/gas-lyria-rt': minor
---

The 0.4 connector interface is in `@luna-estelar/gas/protocol`: `Connector` with `connect()`, and
`Connection` with `update`, `pause`, `resume` and `close`. The old interface is now
`LegacyConnector`, with `LegacyConnectorDescription`, `LegacyConnectorAudioChunk` and
`LegacyAudioChunk`, and it goes later in 0.4. `ConnectorTiming` gains `quarterNoteTempo`.

`RendererDefaults` is now `DocumentDefaults`. `TrackView.source` is `'document'` or `'app'`.

`GasOperationError.kind` is one of `document`, `command`, `state`, `provider` or `cancelled`.

The `session`, `renderer` and `state` schemas are no longer published. The data schemas stay at
1.0.
