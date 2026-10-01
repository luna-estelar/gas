# @luna-estelar/gas-core

## 0.2.1

### Patch Changes

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

- Updated dependencies [[`6e96a67`](https://github.com/luna-estelar/gas/commit/6e96a676f2bb48321ad224e5ec28251c168aa2d6)]:
  - @luna-estelar/gas-protocol@0.3.0

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

- [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2) Thanks [@sathira10](https://github.com/sathira10)! - `validateTimeline` now checks four invariants JSON Schema cannot express, each with its own problem
  code. `events-unordered` catches an event list that is not in order of position and then
  `sequence`, which the cascade relies on to decide which of two events at one position wins.
  `sequence-collision` catches two events sharing both a position and a sequence, where that
  question has no answer. `beat-out-of-range` catches a beat index past the end of its bar and an
  offset of a whole beat or more. `event-outside-section` catches a section-scoped event placed
  outside its own instance, where the value can never take effect.

  Every timeline the compiler produces already satisfies all four; these reject hand-authored,
  persisted and foreign timelines that do not. The beat index is checked only against a meter the
  document declares, because a document that declares none is played at the host's renderer default,
  which a load-time gate cannot see.

### Patch Changes

- [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439) Thanks [@sathira10](https://github.com/sathira10)! - Internal dependency ranges widened to caret, so each package can be released on its own.
- Updated dependencies [[`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2)]:
  - @luna-estelar/gas-protocol@0.2.0

## 0.1.1

### Patch Changes

- Released with the Protocol validator fix; no changes to this package.

## 0.1.0

### Minor Changes

- First public preview. Pure session semantics: input state, the canonical command set,
  the effective-state cascade, and the playback transition rules. Package APIs may change
  in minor releases before 1.0.
