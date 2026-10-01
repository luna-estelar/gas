---
'@luna-estelar/gas-protocol': minor
'@luna-estelar/gas-language': patch
'@luna-estelar/gas-api': patch
'@luna-estelar/gas-browser': minor
'@luna-estelar/gas-renderer': minor
'@luna-estelar/gas-connector-lyria': patch
'@luna-estelar/gas-core': patch
'@luna-estelar/gas-cli': patch
'@luna-estelar/gas-highlight': patch
'@luna-estelar/gas-notation': patch
'@luna-estelar/gas': minor
---

Importing a session no longer loads the GAS compiler. `gas-api` reaches the parser through a
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
