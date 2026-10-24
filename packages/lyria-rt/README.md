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
import { createRenderer } from '@luna-estelar/gas';
import type { MonotonicClock } from '@luna-estelar/gas/protocol';
import { createLyriaRtConnector } from '@luna-estelar/gas-lyria-rt';

declare const clock: MonotonicClock;
declare const apiKey: string;

const renderer = await createRenderer({
  clock,
  connector: createLyriaRtConnector(),
  settings: { apiKey }
});
```

Most apps pass the connector to `createSession` from `@luna-estelar/gas` or `createBrowserSession`
from `@luna-estelar/gas/browser` instead.

## Settings

```ts
import type { LyriaRtConnectorSettings } from '@luna-estelar/gas-lyria-rt';

const settings: LyriaRtConnectorSettings = { apiKey: 'a key authorized for Lyria RealTime' };
```

`endpoint` is optional: an HTTPS origin that speaks the Lyria RealTime WebSocket protocol. It is
rejected if it has userinfo, a path, a query or a fragment. The connector passes the key to the
transport and nowhere else. Getting a key is up to your app.

## Configuration

`validateLyriaRtConfig` checks a configuration against `LYRIA_RT_CONFIG_SCHEMA` without compiling
anything, so it works under a CSP without `'unsafe-eval'`. It reports every problem at once, each
with a JSON Pointer `path` and a code: `wrong-type`, `out-of-range`, `not-allowed` or
`unknown-member`.

## Exports

| Export                                                                                 | Purpose                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `createLyriaRtConnector`                                                               | Create a Lyria RealTime connector                            |
| `LYRIA_RT_CAPABILITIES`                                                                | What Lyria RealTime renders, approximates and cannot render  |
| `LyriaRtConnectorSettings`                                                             | The settings type: `{ apiKey, endpoint? }`                   |
| `validateLyriaRtConfig`, `resolveLyriaRtConfig`                                        | Check a configuration, or resolve one with defaults applied  |
| `LYRIA_RT_CONFIG_SCHEMA`, `DEFAULT_LYRIA_RT_CONFIG`                                    | The configuration options as JSON Schema, and their defaults |
| `translatePrompts`, `createPromptTransition`                                           | Turn effective state into weighted prompts and blend changes |
| `classifyKey`, `LYRIA_RT_SCALES`                                                       | Map a GAS key to the nearest Lyria RealTime scale            |
| `LyriaRtConnectorConfig`, `WeightedPrompt`, `PromptTransition`, `KeyClassification`, … | The type families above                                      |
| `version`                                                                              | This package's version                                       |

## Errors

Failures carry the raw WebSocket close code as `closeCode`:

| Close code                 | Failure                     | Reason     | Retryable |
| -------------------------- | --------------------------- | ---------- | --------- |
| 1007 or 1008, before setup | `lyria-rt-auth-rejected`    | `auth`     | no        |
| 1002 or 1011               | `lyria-rt-provider-failure` | `provider` | yes       |
| anything else              | `lyria-rt-network-failure`  | `network`  | yes       |

Application codes (4000-4999) are reported as network failures. Their meaning is up to whoever
runs the endpoint.

Calling `stop()` or `close()` during `start()` rejects the start with `lyria-rt-start-cancelled`.
If the connection opens after that, the connector closes it.

## What Lyria RealTime supports

| Intent                             | Lyria RealTime |
| ---------------------------------- | -------------- |
| `flavor`, `tempo`, `timbre`        | supported      |
| `key`, `level`                     | approximated   |
| `time_signature`, `notes`, `motif` | unsupported    |

Unsupported intents still compile and stay in session state, and GAS warns about them.

Checks against the real service are in the
[manual guide](https://github.com/luna-estelar/gas/tree/main/packages/lyria-rt/manual).

## Runtime support

ESM only. Node.js 22 or newer, and browsers. Its only dependency is `@google/genai`.

## License

MIT
