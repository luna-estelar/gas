# @luna-estelar/gas-renderer

## 0.3.0

### Minor Changes

- [`6e96a67`](https://github.com/luna-estelar/gas/commit/6e96a676f2bb48321ad224e5ec28251c168aa2d6) Thanks [@sathira10](https://github.com/sathira10)! - Importing a session no longer loads the GAS compiler. `gas-api` reaches the parser through a
  dynamic import, and `slugify` moves to `gas-protocol`, which both the compiler and a host deriving
  a live track id now share. Every entry point except `@luna-estelar/gas/language` and
  `@luna-estelar/gas/browser/compile` is parser-free, including the umbrella root and
  `browser/session`, and each one is checked by importing it under a resolve hook that rejects
  Langium. `gas-language` also declares `sideEffects: false`.

  `submitLiveCommands` no longer discards a command accepted while it was preparing. It read the
  session state before resolving the source, then wrote its result after, so a programmatic command
  that committed in between — during a `sourceUrl`, `sourceFile` or `sourceBlob` read — was applied
  and then silently lost. The state is now read after that wait, and nothing yields between reading
  it and committing.

  The Lyria connector converts tempo before sending it. A GAS tempo counts the meter's `beatUnit`,
  while Lyria's `bpm` counts quarter notes, so the connector now sends `tempo * 4 / beatUnit` and
  decides clamping against that value. Previously a document in any meter other than `x/4` was
  generated at a different tempo than the Renderer's clock assumed, and the two drifted apart.
  `ConnectorTiming.tempo` documents the unit so no other connector repeats this.

  `openAudioContext` no longer waits indefinitely for `resume()`. A browser that refuses to start
  audio may leave that promise pending rather than rejecting, which made `createBrowserSession`
  never resolve — the host received no context at all, and so could not offer the gesture that
  would have fixed it. The wait is now bounded and `resumed` still comes from `context.state`.
  `BrowserSession` additionally exposes its `context`, so a host can read `state`, watch
  `statechange` and retry `resume()` itself. Ownership is unchanged: `close()` still closes only a
  context the session opened.

  **Breaking:** `PlaybackEngine.fadeOut` and `PlaybackEngine.restoreGain` are removed. Nothing in
  the library called either, and every engine implementation had to provide them.

  **Breaking:** `RendererStatusEvent.throttled` now reports only the Renderer's own flow control. A
  provider reporting that it slowed down continues to arrive as `stream === 'throttled'`; the two
  were previously merged into `throttled`, which left a host unable to tell a model struggling to
  keep up from one being deliberately restrained.

  `ChainedSourceEngine.flush` is now a no-op once the engine is closed, matching `push` and `close`.

  **Breaking:** every package's `packageName` constant is removed. `version` stays, and
  `@luna-estelar/gas-protocol` additionally exports `slugify`.

  **Breaking:** `CreateRendererOptions.anchor` is removed. Musical time always starts at the first
  audible sample, which is what makes the Renderer's clock agree with what a listener hears. The
  other setting anchored at `connector.start()`, before any audio existed, and only existed to
  restore the timing that predated that fix.

  **Breaking:** `CreateRendererOptions.checkConnectorContract` is removed and the check it gated now
  always runs. A connector whose own `validateConfig` rejects its own advertised `defaultConfig` is
  refused at `createRenderer`, rather than passing initialization and failing confusingly later.

  Every package README points its build badge at the workflow that now runs on `main`.

  **Breaking:** `GasSession.loadTimeline` takes only the timeline. Its second `CompileOptions`
  argument was accepted and ignored; a loaded timeline is already compiled.

### Patch Changes

- Updated dependencies [[`6e96a67`](https://github.com/luna-estelar/gas/commit/6e96a676f2bb48321ad224e5ec28251c168aa2d6)]:
  - @luna-estelar/gas-protocol@0.3.0
  - @luna-estelar/gas-core@0.2.1
  - @luna-estelar/gas-notation@0.1.3

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
