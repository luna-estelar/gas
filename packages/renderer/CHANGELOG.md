# @luna-estelar/gas-renderer

## 0.2.0

### Minor Changes

- [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2) Thanks [@sathira10](https://github.com/sathira10)! - The conversion between a musical position and clock seconds now lives in Core, so a host can place
  the audible playhead without depending on the Renderer. The Renderer still exports every one of
  these names, re-exported from Core.

  `positionToTime` and `timeToPosition` replace bar-only arithmetic and account for beats.
  `timeToPosition` always returns a position the protocol allows: a whole bar, and a beat offset in
  whole ticks over `TICKS_PER_BEAT` (960). Rounding to whole ticks carries a near-miss forward, so a
  value a hair under the next beat becomes that beat at offset 0 and one a hair under the next bar
  becomes the next bar — a position is never reported past the end of its own bar, and a fractional
  bar is never reported at all.

  `timeToBar` is renamed `timeToBarFraction`. It behaves exactly as before, returning the continuous
  bar coordinate; the name now says so, because that value is not a `MusicalPosition`. Use it for bar
  arithmetic, above all re-anchoring a tempo change at the exact current instant.

  Tempo is defined as beats per minute where a beat is the meter's `beatUnit` note, so `secondsPerBar`
  is `beatsPerBar x 60 / tempo` with no `4 / beatUnit` factor: at 120 BPM an event on beat 3 lands
  1.0 s into its bar in 6/8 exactly as in 4/4. `TempoSegment` gains `beatUnit` so a tempo map
  describes its own beat; `reanchorTempo` takes an optional `beatUnit` and otherwise keeps the meter
  already in force.

  `comparePositions` and `positionsEqual` are now exported from the package root.

- [`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776) Thanks [@sathira10](https://github.com/sathira10)! - Musical time now starts with the first audible sample. A connector whose `start()` resolves at
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
  given. After a finite piece completes it keeps answering for that run, capped at the declared end,
  until the next `start()` or a `stop()`, so a playhead can follow the audio a host is still playing
  out. `comparePositions` and `positionsEqual` are re-exported from Core alongside the
  other musical-time helpers.

### Patch Changes

- [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439) Thanks [@sathira10](https://github.com/sathira10)! - Internal dependency ranges widened to caret, so each package can be released on its own.
- Updated dependencies [[`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2), [`864382a`](https://github.com/luna-estelar/gas/commit/864382a00805593b954301351f3938e6e503fd74), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2)]:
  - @luna-estelar/gas-core@0.2.0
  - @luna-estelar/gas-notation@0.1.2
  - @luna-estelar/gas-protocol@0.2.0

## 0.1.1

### Patch Changes

- A session no longer compiles the connector's configuration schema at startup. The
  connector contract check it performed is now opt-in through `checkConnectorContract`,
  and the schema is compiled on the first `updateConnectorConfig` call.

## 0.1.0

### Minor Changes

- First public preview. The clock-driven scheduler, musical-to-clock conversion, and
  connector lifecycle. Package APIs may change in minor releases before 1.0.
