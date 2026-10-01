# @luna-estelar/gas-browser

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
  - @luna-estelar/gas-language@0.1.3
  - @luna-estelar/gas-api@0.2.1
  - @luna-estelar/gas-renderer@0.3.0
  - @luna-estelar/gas-core@0.2.1

## 0.2.0

### Minor Changes

- [`7187051`](https://github.com/luna-estelar/gas/commit/7187051bbee674c36d9ca492cdc54e8d6e386866) Thanks [@sathira10](https://github.com/sathira10)! - Rewritten as generic browser infrastructure for any site: a session, a playback engine and
  helpers, with no connector dependency and no key handling.

  - `./session`: `createBrowserSession({ connector, settings, context?, prebufferSeconds?, capture?, engine?, renderer? })`
    composes the api, the renderer and the audio engine around any connector the host passes in.
    `audiblePosition()` reports the bar and beat the listener is hearing, through the renderer's
    `positionAtSeconds`. The session flushes audio on a host stop or renderer failure and plays out
    the tail of a completed piece. It exports `version`.
  - `./audio`: `PlaybackEngine` and `ChainedSourceEngine`, which chains `AudioBufferSourceNode`s on
    exact, drift-free start times behind a prebuffer (one chunk duration by default) and counts underruns.
    This fixes the dropout on every chunk boundary (LE-89). Also `AudioClock`, `openAudioContext`
    and `detectSupport`.
  - `./capture`: `PcmCapture`, `decodeS16lePcm` and `encodeWave`, moved from `./audio`.
  - `./timeline`: `positionSeconds` delegates to Core's `positionToTime`. A beat is the meter's
    `beatUnit` note, so 6/8 positions no longer scale by `4 / beatUnit`.

  Removed: `./wiring` (use `./session`), `./access` and `./config` (the host builds connector
  settings itself; a key the visitor pastes and one the site fetches arrive the same way),
  `./playback` (use `./audio`), and `./bitsy/*`. The Bitsy integration moves to the website and
  remains in git history at `packages/browser/src/bitsy` in commit `e85f15e`.

### Patch Changes

- [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439) Thanks [@sathira10](https://github.com/sathira10)! - Internal dependency ranges widened to caret, so each package can be released on its own.
- Updated dependencies [[`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776), [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2), [`b98522b`](https://github.com/luna-estelar/gas/commit/b98522bb8a61fb00b5cbb2f4ca7e8f4557d07c7b), [`864382a`](https://github.com/luna-estelar/gas/commit/864382a00805593b954301351f3938e6e503fd74), [`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2)]:
  - @luna-estelar/gas-api@0.2.0
  - @luna-estelar/gas-core@0.2.0
  - @luna-estelar/gas-language@0.1.2
  - @luna-estelar/gas-protocol@0.2.0
  - @luna-estelar/gas-renderer@0.2.0

## 0.1.1

### Patch Changes

- Released with the Protocol validator fix; no changes to this package.

## 0.1.0

### Minor Changes

- First public preview. The framework-free browser host, as explicit subpaths with no root
  barrel. Package APIs may change in minor releases before 1.0.
