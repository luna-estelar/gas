# @luna-estelar/gas-browser

The browser host for GAS: it composes a session, the renderer and gapless Web Audio playback for
any site, and adds timeline view models, in `document → language → timeline → session → renderer →
connector → model`.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-browser)](https://www.npmjs.com/package/@luna-estelar/gas-browser)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas-browser)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/ci.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/ci.yml)

## Install

```bash
npm install @luna-estelar/gas-browser
```

Part of `@luna-estelar/gas`, which installs every package; there it is the `/browser/*` subpaths.

## Example

The host chooses the connector and supplies its settings. This package never imports a
connector and never stores a key.

```ts
import { sourceText } from '@luna-estelar/gas-api';
import { createLyriaConnector } from '@luna-estelar/gas-connector-lyria';
import { createBrowserSession } from '@luna-estelar/gas-browser/session';

declare const apiKey: string;
declare const document: string;

// Call from a click handler: the audio context is opened before the first await,
// so it starts inside the gesture.
const browser = await createBrowserSession({
  connector: createLyriaConnector,
  settings: { apiKey }
});
browser.audio.on('status', (status) => console.log(status.state, status.underruns));
await browser.session.loadSource(sourceText(document));
await browser.session.play();

// On each animation frame: the bar and beat the listener is hearing now.
console.log(browser.audiblePosition()?.position);
```

`connector` takes a connector or a factory for one. A connector opens only once, so pass a
factory if the host calls `session.retryRenderer()` after a failure.

### Hosting your own key

The library takes `apiKey` and, for the Lyria connector, an optional `endpoint`. How a site
obtains a key is its own decision: a key the visitor pastes and a key the site fetches from its
own backend arrive the same way.

## Exports

| Subpath      | Exports                                                                                    | Purpose                                                                         |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `./session`  | `createBrowserSession`, `BrowserSession`, `BrowserSessionOptions`, `version`               | Compose api, renderer and audio engine; the only module that loads the renderer |
| `./audio`    | `PlaybackEngine`, `ChainedSourceEngine`, `AudioClock`, `openAudioContext`, `detectSupport` | Web Audio playback and the device clock                                         |
| `./capture`  | `PcmCapture`, `decodeS16lePcm`, `encodeWave`                                               | Record a run and offer it as a WAV file                                         |
| `./compile`  | `compileGas`, `highlightGas`, `previewLiveCommands`, …                                     | Compile and highlight GAS source; loads the parser                              |
| `./timeline` | `deriveTimeline`, `positionSeconds`, `formatClock`, …                                      | Timeline view models, with positions placed by `gas-core`                       |
| `./inspect`  | `inspectTimeline`                                                                          | Effective state at a position, without the compiler                             |

There is no root entry. `./compile` loads the language package, Langium and Chevrotain, so
import it dynamically when compilation can wait.

### Playback

`ChainedSourceEngine` plays each chunk as an `AudioBufferSourceNode` started at the exact time
the previous chunk ends, so consecutive chunks join without a gap, a click or accumulated drift at
any output sample rate.

`prebufferSeconds` (default: one chunk duration of the connector's model, clamped to 0.25–4 s)
is the delay between a chunk's arrival and its playback. It is not the amount of audio in a
queue. A real-time model delivers each chunk at about the moment the previous one starts, so
this delay is the whole margin against a late chunk. With Lyria's 2 s chunks, a late chunk has
about 2 s before it is heard. Playback starts sooner if the connector has already delivered a
prebuffer's worth beyond the first chunk. After an underrun the engine counts it and waits the
same way again, starting from the late chunk.

The session drives the engine from its own events:

| Session signal                                        | Engine                                                  |
| ----------------------------------------------------- | ------------------------------------------------------- |
| a finite piece completes (`lifecycle.completed`)      | plays out the delivered tail, then reaches `stopped`    |
| the renderer stops without completing (host `stop()`) | `flush()`: 20 ms ramp to silence, queued audio dropped  |
| `error` with `kind: 'renderer'`                       | `flush()`                                               |
| audio from a new run                                  | flushes the old run; gain returns to 1 at the new start |

`audiblePosition()` maps the engine's `playheadSeconds()` (output latency and inserted silence
accounted for) through the renderer's `positionAtSeconds`. It never estimates latency from
the last position event.

An adopted `context` is never closed by the session. A context the session opened is closed by
`close()`.

## Runtime support

ESM-only. Runs in current browsers with Web Audio. Node.js 22 or newer is required only to
install and build (the compiler dependency). Importing any subpath touches no browser global;
only `./audio`'s clock listens for `visibilitychange`, and only after it is constructed.

## Related packages

Depends on `@luna-estelar/gas-protocol`, `gas-core`, `gas-api`, `gas-renderer` and
`gas-language` (through `./compile` only). It works with any connector, such as
`@luna-estelar/gas-connector-lyria`.

## License

MIT
