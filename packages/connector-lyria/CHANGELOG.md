# @luna-estelar/gas-connector-lyria

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

- [`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776) Thanks [@sathira10](https://github.com/sathira10)! - Connector settings are now `{ apiKey, endpoint? }`. How an application obtains a key is the
  application's own concern, so the hosted arm of the old settings union leaves with its sentinel key
  and its private close-code table. An `endpoint` is any HTTPS origin that speaks the Lyria WebSocket
  protocol; it is reduced to its origin and refused if it carries userinfo, a query, a fragment or a
  path, so a credential cannot hide in one.

  Close-code classification covers the standard codes only, and every failure now carries the raw
  number through as `closeCode`. Google closes with 1007 for a malformed key and 1008 for a rejected
  one, both before setup completes, so both are authentication failures there and transport noise
  afterwards; 1002 and 1011 are provider failures. Everything else, including the application range
  4000-4999, is reported as a network failure with the number attached for the host to interpret. One
  consequence worth knowing: no close code maps to `reason: 'quota'` any more, so 4429 arrives as a
  retryable network failure carrying 4429 rather than as `lyria-quota-exhausted`.

  `validateConfig` implements the Protocol's optional connector-owned validation, so the Renderer can
  check a configuration edit without compiling a schema. It reports every problem at once rather than
  stopping at the first, since which one a caller hears should not depend on the order the members
  happen to be in, and names each by JSON Pointer with one of the codes `wrong-type`, `out-of-range`,
  `not-allowed` or `unknown-member`.

### Patch Changes

- [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439) Thanks [@sathira10](https://github.com/sathira10)! - Internal dependency ranges widened to caret, so each package can be released on its own.
- Updated dependencies [[`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2)]:
  - @luna-estelar/gas-protocol@0.2.0

## 0.1.1

### Patch Changes

- Released with the Protocol validator fix; no changes to this package.

## 0.1.0

### Minor Changes

- First public preview. The Lyria RealTime boundary: prompt translation, transport, and
  capability reporting. Package APIs may change in minor releases before 1.0.

### Known limitations

- Lyria is the only connector.
- Lyria supports `flavor`, `tempo` and `timbre`, and approximates `key` and `level`.
- `time_signature`, `notes` and `motif` compile and remain in session state, but Lyria
  cannot render them. GAS reports a capability warning rather than dropping them.
