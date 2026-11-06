# @luna-estelar/gas-lyria-rt

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-lyria-rt)](https://www.npmjs.com/package/@luna-estelar/gas-lyria-rt)

Plays [GAS](https://gas.lunaestelar.com) documents through Lyria RealTime, Google's real-time music
model. It turns tracks, tempo and sections into Lyria prompts and settings and streams the audio
back. You
need a Gemini API key with Lyria RealTime access.

## Install

```bash
npm install @luna-estelar/gas @luna-estelar/gas-lyria-rt
```

`@luna-estelar/gas` is a peer dependency.

## Example

```ts
import { createSession } from '@luna-estelar/gas';
import { createLyriaRtConnector } from '@luna-estelar/gas-lyria-rt';

declare const apiKey: string;

const session = await createSession({ connector: createLyriaRtConnector({ apiKey }) });
```

In a browser, pass the connector to `createBrowserSession` from `@luna-estelar/gas/browser`
instead.

## Options

- `apiKey`: a key authorized for Lyria RealTime, or a function that returns one. The function is
  called once per Play, so it can fetch a short-lived token. If it throws or returns an empty
  string, Play fails with `lyria-rt-api-key-unavailable`.
- `endpoint`: optional. An HTTPS origin that speaks the Lyria RealTime WebSocket protocol. It is
  rejected if it has userinfo, a path, a query or a fragment.
- `translate` and `transition`: optional hooks, below.

`createLyriaRtConnector` throws `lyria-rt-invalid-settings` for a bad option. The connector passes
the key to the transport and nowhere else. Getting a key is up to your app.

## Changing the translation

`translate` turns the session's state into weighted prompts. The default is exported, so a hook
can wrap it:

```ts
import { createLyriaRtConnector, translatePrompts } from '@luna-estelar/gas-lyria-rt';

declare function getToken(): Promise<string>;

const connector = createLyriaRtConnector({
  apiKey: () => getToken(),
  translate: (state, config) =>
    translatePrompts(state, config.prompt).map((p) => ({ ...p, weight: p.weight ** 1.5 }))
});
```

`translate` is pure and synchronous, so you can test it without a socket. If it throws or returns
an empty text or a weight that isn't finite, the change fails with `lyria-rt-translate-failed`.

`transition` makes the crossfade for each connection. The default is `createPromptTransition`.

To build your own connector, use `openLyriaRtSession` (the socket, setup and audio) and
`LYRIA_RT_DESCRIPTION`. A variant that renders differently needs its own id:
`{ ...LYRIA_RT_DESCRIPTION, id: 'my-lyria' }`.

## Configuration

`validateLyriaRtConfig` checks a configuration against `LYRIA_RT_CONFIG_SCHEMA` without compiling
anything, so it works under a CSP without `'unsafe-eval'`. It reports every problem at once, each
with a JSON Pointer `path` and a code: `wrong-type`, `out-of-range`, `not-allowed` or
`unknown-member`.

## Exports

| Export                                                                              | Purpose                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `createLyriaRtConnector`                                                            | Create a Lyria RealTime connector                            |
| `LYRIA_RT_DESCRIPTION`, `LYRIA_RT_CAPABILITIES`                                     | What the connector is, and what Lyria RealTime renders       |
| `LyriaRtConnectorOptions`, `LyriaRtApiKey`, `LyriaRtTranslate`                      | The option types                                             |
| `validateLyriaRtConfig`, `resolveLyriaRtConfig`                                     | Check a configuration, or resolve one with defaults applied  |
| `LYRIA_RT_CONFIG_SCHEMA`, `DEFAULT_LYRIA_RT_CONFIG`                                 | The configuration options as JSON Schema, and their defaults |
| `translatePrompts`, `createPromptTransition`                                        | The default translation and crossfade                        |
| `openLyriaRtSession`                                                                | The transport, for building your own connector               |
| `classifyKey`, `LYRIA_RT_SCALES`                                                    | Map a GAS key to the nearest Lyria RealTime scale            |
| `LyriaRtConnectorConfig`, `WeightedPrompt`, `PromptTransition`, `LyriaRtSession`, … | The type families above                                      |
| `version`                                                                           | This package's version                                       |

## Errors

Failures carry the raw WebSocket close code as `closeCode`:

| Close code                 | Failure                     | Reason     | Retryable |
| -------------------------- | --------------------------- | ---------- | --------- |
| 1007 or 1008, before setup | `lyria-rt-auth-rejected`    | `auth`     | no        |
| 1002 or 1011               | `lyria-rt-provider-failure` | `provider` | yes       |
| anything else              | `lyria-rt-network-failure`  | `network`  | yes       |

Application codes (4000-4999) are reported as network failures. Their meaning is up to whoever
runs the endpoint.

## What Lyria RealTime supports

| Intent                             | Lyria RealTime |
| ---------------------------------- | -------------- |
| `flavor`, `tempo`, `timbre`        | supported      |
| `key`, `level`                     | approximated   |
| `time_signature`, `notes`, `motif` | unsupported    |

Unsupported intents still compile and stay in session state, and GAS warns about them.

Lyria takes about a second to send audio after a pause, so the connector reports
`startupDelaySeconds: 1.2` for a warm resume and `initialStartupDelaySeconds: 5.4` for the first
play on a fresh connection. GAS uses the cold budget until audio has arrived. If an opening rest
is shorter than the required lead, GAS prepares the first entry before starting the musical
clock, then plays the full written rest. Later short rests keep the provider generating while
GAS writes silence.

Checks against the real service are in the
[manual guide](https://github.com/luna-estelar/gas/tree/main/packages/lyria-rt/manual).

## Runtime support

ESM only. Node.js 22 or newer, and browsers. Its only dependency is `@google/genai`.

## License

MIT
