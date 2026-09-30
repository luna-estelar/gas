---
'@luna-estelar/gas-renderer': minor
---

Musical time now starts with the first audible sample. A connector whose `start()` resolves at
session setup — Lyria's does, before any audio exists — used to have bar one anchored there, so the
musical clock ran ahead of the audible one by however long generation took to begin and every chunk
after that was needed earlier than it arrived. `start()` still resolves as soon as the run is
allocated, so playback stays `starting` until audio arrives, and a host that changes state in that
window is answered at bar one rather than refused. `anchor: 'connector-start'` keeps the old timing
for a connector whose start already means audio is flowing, and `firstAudioTimeoutSeconds` fails a
run that connects and then stays silent, defaulting to three chunk durations clamped to 2-15 seconds.

Authored positions are no longer flattened to their bar: an event on a beat is scheduled on that
beat, and `requestedPosition` is a position the protocol allows instead of a fractional bar. Tempo
re-anchoring still reads the continuous bar coordinate, which is the one thing a position cannot
express, so a live tempo change takes effect exactly where it happened.

A finite piece reaching its declared length emits a terminal status carrying both its run id and
`completed: true`, then the ordinary `stopped` status. That is what lets a session tell a piece that
finished from one a host stopped; previously the run id was cleared before the last status, so the
event named no run and no session could match it. The run also ends before the connector is asked to
stop, so a chunk generated during that round trip is refused rather than accepted into a run that is
over.

Configuration edits are checked by the connector through the optional `Connector.validateConfig`,
and nothing in this package compiles a schema any more, so every configuration path works under a
Content Security Policy without `'unsafe-eval'`. `ajv` and `ajv-formats` are no longer dependencies,
and `compileConfigSchema` and `SanitizedSchemaProblem` are gone with them; `RendererError.problems`
now holds the connector's own `ConnectorConfigProblem` shape, or Core's timeline problems when a
timeline was what failed. A connector that does not implement `validateConfig` still works, with one
`connector-config-unvalidated` warning the first time a host edits its configuration.

Transport close codes are forwarded to every emitted failure, and `positionAtSeconds` maps seconds
after the anchor to a musical position so a host can place a playhead against the audio it has
actually played. It returns `undefined` for an instant the live tempo map cannot place: a loop
boundary rebuilds that map from bar one, so a host still catching up to a rollover is asking about an
iteration the map no longer describes, and answering bar one would walk its playhead backwards. A
host that wants a playhead to sit still through a rollover should hold the last position it was
given. `comparePositions` and `positionsEqual` are re-exported from Core alongside the
other musical-time helpers.
