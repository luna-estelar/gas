# @luna-estelar/gas

## 0.4.0

### Minor Changes

- `audiblePosition()` is now the `audiblePosition` session event, emitted as the listener hears each
  position: every beat, plus each `generationPosition` with the same payload. `createBrowserSession`
  takes `documentDefaults`.

- The 0.4 connector interface is in `@luna-estelar/gas/protocol`: `Connector` with `connect()`, and
  `Connection` with `update`, `pause`, `resume` and `close`. `ConnectorTiming` gains
  `quarterNoteTempo`. `ModelInfo` gains optional `startupDelaySeconds` and
  `initialStartupDelaySeconds` budgets for warm resumes and the first play on a fresh connection.
  GAS resumes the model that much plus one chunk before a track comes in after a rest.

  `RendererDefaults` is now `DocumentDefaults`. `TrackView.source` is `'document'` or `'app'`.

  `GasOperationError.kind` is one of `document`, `command`, `state`, `provider` or `cancelled`.

- Live text can clear what it sets, so an app can hand a value back to the score.

  - `strings.level clear`, and the same for `flavor`, `timbre`, `notes` and `motif`.
  - `strings.release` hands the track's play state back to the score.
  - `track strings clear` removes an app track.
  - `tempo clear`, `flavor clear` and `level clear` for the globals.
  - Live text now accepts global `flavor "..."` and `level 0.5`, which it used to reject with
    `live-global-not-allowed`. `key`, `time_signature` and `length` are still rejected.

  `clear` and `release` only work in live text. In a document they give `clear-not-allowed`. Both
  can still name a track.

- App values now sit above the score however and whenever they were set, and they last until the
  app clears them. Stop, completion and a failure keep them. A value set before Play sounds
  the same as one set during Play.

  `submitLiveCommands` applies a submission fully or not at all. A failing statement rejects, and
  `LiveCommandFailureResult` is gone.

  New session methods: `apply(commands)` applies a group fully or not at all, `clearAppValues()`
  removes every app track and value, and `clearTrackNotes`, `clearTrackMotif`, `clearTrackPlay` and
  `removeTrack` cover the new commands. `getState().appValues` lists the app tracks and values as
  commands you can pass back to `apply`.

  `loadSource` and `loadTimeline` take `{ appValues: 'keep' | 'clear' | Command[] }`, default
  `'keep'`. A kept value whose track is gone is dropped with an `app-value-dropped` warning. A
  `'keep'` load fails with `duplicate-track` when the new document declares an app track's id.
  Commands and a second load reject while a document is loading.

  Defining an app track again with the same name and description does nothing, so a saved
  `getState().appValues` can be applied to the session that produced it.

  `InputState` is now `{ timeline, appTracks, appValues }`, `HostTrack` is `AppTrack`, and
  `applyCommand` no longer takes a `phase`. `applyStop`, `applyCompletion` and `applyRetry` are
  removed. `applyCommands` and `applyNewTimeline` are new.

- GAS owns the connection lifecycle, and the session is the only public object.

  - `createSession({ connector, clock?, documentDefaults?, connectorConfig? })` builds everything.
    The renderer is internal: `createRenderer`, `session.renderer`, `RendererControl`,
    `SessionWiring` and `retryRenderer()` are gone.
  - `firstAudioTimeoutSeconds` on `createSession` and `createBrowserSession` sets how long a playing
    track may go without audio before the session fails. It defaults to three chunks and is clamped
    to 2-15 s.
  - Each Play opens a new connection. Play resolves once it is open, rejects with `provider` if it
    can't open, and rejects with `cancelled` if Stop or Close came first. Stop and Close return at
    once.
  - A failure during playback emits one `error` and leaves the session stopped. Play works again
    on the same session.
  - `getState()` is `{ status, loaded, ended?, tracks, appValues }`, and one `state` event reports
    every change. The events are `state`, `generationPosition`, `audio`, `warning` and `error`.
    `lifecycle`, `position` and `diagnostic` are gone, and no payload carries a `runId`.
  - While no track plays, GAS writes silence and musical time keeps going. It pauses the model
    during a rest and resumes it, with the next track's update, one chunk plus the model's start-up
    delay before that track comes in. A rest too short to be worth it keeps the entry's prompts
    active so the connector also keeps generating. Edits during the lead preserve the entry's
    tracks, and intervening score boundaries cannot replace them with an inactive rest state.
    If an opening rest is shorter than the cold-start lead, GAS prepares the first entry before
    starting the musical clock and preserves the full written rest.
  - New session methods: `getCapabilities`, `getModelInfo`, `getConnectorConfig`,
    `updateConnectorConfig`, `getConfigSchema`, `getDocumentDefaults`, `updateDocumentDefaults` and
    `setConnector`.
  - The `Legacy*` connector types are removed. `createBrowserSession` takes a `Connector`, with no
    factory, `settings` or `renderer` option.
  - `diagnostics.schema.json` no longer defines `RendererWarning` or `RendererFailure`. The
    `session`, `renderer` and `state` schemas are no longer published. The data schemas stay at 1.0.
  - `OverrideCommand` is `AppValueCommand`, and `Override` is `AppValue`. The schema def in
    `commands.schema.json` is renamed to match.
  - `PlaybackWarning` is `PlayWarning`.
  - `submitLiveCommands` returns `SubmitLiveCommandsResult`, which is `CommandResult` plus
    `applied`. `LiveCommandSuccess`, `LiveCommandResult` and its `ok` field are gone.
  - `ConnectorSettings` and `ConnectorAudioChunk.final` are removed.

## 0.3.0

### Minor Changes

- GAS is now one package. The ten `@luna-estelar/gas-*` packages it used to depend on are folded
  in, and the export map is smaller:

  - `@luna-estelar/gas` exports what `./api` did, plus `createRenderer` and `version`.
  - `@luna-estelar/gas/browser` replaces `./browser/session`, `./browser/audio`, `./browser/capture`,
    `./browser/timeline` and `./browser/inspect`.
  - `@luna-estelar/gas/language` also has the editor helpers from `./browser/compile`.
  - `./core` and `./notation` are internal now. `./renderer` is gone; use `createRenderer` from the
    root.
  - `./lyria` is gone. The connector is a separate package, `@luna-estelar/gas-lyria-rt`.

  `./protocol`, `./protocol/validation` and `./highlight` are unchanged.

- Stop and Close no longer wait behind a slow connector. They overtake in-flight connector work and
  wait for its stop or close only up to a cleanup timeout, measured in wall time so a suspended
  AudioContext cannot stall it. A second Stop shares the first one's outcome.

  A Play that settles after Stop, Close or `retryRenderer()` is ignored instead of reviving the
  session. A connector can prepare again after a Stop that landed during prepare. Connectors now get
  the run's default tempo in `ConnectorTiming`, not an override that happened to be active at start.

## 0.2.0

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
  - @luna-estelar/gas-browser@0.3.0
  - @luna-estelar/gas-renderer@0.3.0
  - @luna-estelar/gas-connector-lyria@0.2.1
  - @luna-estelar/gas-core@0.2.1
  - @luna-estelar/gas-cli@0.1.3
  - @luna-estelar/gas-highlight@0.1.3
  - @luna-estelar/gas-notation@0.1.3

## 0.1.0

### Minor Changes

- [`4c7f950`](https://github.com/luna-estelar/gas/commit/4c7f950ca4d1c1377982d211b9710cbe26c59a73) Thanks [@sathira10](https://github.com/sathira10)! - First release of `@luna-estelar/gas`, one install for the language, the session runtime, the
  renderer and the Lyria connector.

  - The root re-exports `@luna-estelar/gas-api` (sessions, source helpers, `GasOperationError` and
    the protocol types a host handles), plus this package's own `packageName` and `version`.
  - Every package is available at a subpath that mirrors it: `/protocol`, `/protocol/validation`,
    `/language`, `/core`, `/api`, `/renderer`, `/notation`, `/highlight`, `/lyria`, and
    `/browser/{session,audio,capture,compile,timeline,inspect}`. Only `/lyria` loads the Google
    GenAI SDK.
  - The `gas` command runs `@luna-estelar/gas-cli`; use it as `npx @luna-estelar/gas`.

  Dependencies are pinned to exact versions, so use this package or the individual packages, not
  both at different versions.

### Patch Changes

- Updated dependencies [[`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776), [`7187051`](https://github.com/luna-estelar/gas/commit/7187051bbee674c36d9ca492cdc54e8d6e386866), [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439), [`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776), [`b98522b`](https://github.com/luna-estelar/gas/commit/b98522bb8a61fb00b5cbb2f4ca7e8f4557d07c7b), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2), [`b98522b`](https://github.com/luna-estelar/gas/commit/b98522bb8a61fb00b5cbb2f4ca7e8f4557d07c7b), [`864382a`](https://github.com/luna-estelar/gas/commit/864382a00805593b954301351f3938e6e503fd74), [`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2)]:
  - @luna-estelar/gas-api@0.2.0
  - @luna-estelar/gas-browser@0.2.0
  - @luna-estelar/gas-cli@0.1.2
  - @luna-estelar/gas-connector-lyria@0.2.0
  - @luna-estelar/gas-core@0.2.0
  - @luna-estelar/gas-highlight@0.1.2
  - @luna-estelar/gas-language@0.1.2
  - @luna-estelar/gas-notation@0.1.2
  - @luna-estelar/gas-protocol@0.2.0
  - @luna-estelar/gas-renderer@0.2.0
