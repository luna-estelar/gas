# @luna-estelar/gas-protocol

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

## 0.2.0

### Minor Changes

- [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2) Thanks [@sathira10](https://github.com/sathira10)! - `ConnectorError` now accepts an optional `closeCode`, and `RendererFailure` gains the matching
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

### Patch Changes

- [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439) Thanks [@sathira10](https://github.com/sathira10)! - Internal dependency ranges widened to caret, so each package can be released on its own.

## 0.1.1

### Patch Changes

- The canonical timeline validator is precompiled at build time instead of being built
  with AJV when the module is imported. Importing the protocol validator, Core, the
  Renderer or a browser session generated code at runtime, which a Content Security Policy
  without `'unsafe-eval'` blocks, so no deployed page could start a session. Validation
  behaviour and reported problems are unchanged.

## 0.1.0

### Minor Changes

- First public preview. The transport-neutral contracts every other package shares, with
  Draft 2020-12 JSON Schemas for the Protocol 1.0 value families. Package APIs may change
  in minor releases before 1.0.
