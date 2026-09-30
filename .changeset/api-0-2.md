---
'@luna-estelar/gas-api': minor
---

A finite piece now actually completes its session. The session used to end a run on
`stream: 'ended'`, a value the real Renderer never produced, so completion worked only against a
fake renderer: overrides were never cleared and the session stayed `active` after the music stopped.
It now ends on the Renderer's own `completed` flag, and forwards that flag on the `lifecycle` event
so a host can tell a piece that finished from one it stopped. A provider that ends its stream early
no longer ends the session, because a stream that stopped is not a piece that finished.

`GasOperationError` gains `closeCode`, the raw transport close code, passed through unclassified for
a host to map. It reaches both the `error` event and the error thrown by a failed `play()`, held to
the Protocol's own range so no gate here is looser than the structural guard or the JSON Schema.
