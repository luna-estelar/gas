# @luna-estelar/gas-lyria

Use Google's Lyria RealTime music model with GAS. It turns your tracks, tempo and sections into
Lyria prompts and settings, and streams the audio back. You need a Gemini API key with Lyria
access.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-lyria)](https://www.npmjs.com/package/@luna-estelar/gas-lyria)

## Install

```bash
npm install @luna-estelar/gas @luna-estelar/gas-lyria
```

`@luna-estelar/gas` is a peer dependency, so your application and the connector share one copy of
it.

## Example

```ts
import { createRenderer } from '@luna-estelar/gas';
import type { MonotonicClock } from '@luna-estelar/gas/protocol';
import { createLyriaConnector } from '@luna-estelar/gas-lyria';

declare const clock: MonotonicClock;
declare const apiKey: string;

const renderer = await createRenderer({
  clock,
  connector: createLyriaConnector(),
  settings: { apiKey }
});
```

Most applications hand this to a session instead: see `createSession` in `@luna-estelar/gas`, or
`createBrowserSession` in `@luna-estelar/gas/browser`, which takes the connector the same way.

## Exports

| Export                                                                               | Purpose                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `createLyriaConnector`                                                               | Create a Lyria connector                                     |
| `LYRIA_CAPABILITIES`                                                                 | What Lyria renders, approximates and cannot render           |
| `LyriaConnectorSettings`                                                             | The settings type: `{ apiKey, endpoint? }`                   |
| `validateLyriaConfig`, `resolveLyriaConfig`                                          | Check a configuration, or resolve one with defaults applied  |
| `LYRIA_CONFIG_SCHEMA`, `DEFAULT_LYRIA_CONFIG`                                        | The configuration options as JSON Schema, and their defaults |
| `translatePrompts`, `createPromptTransition`                                         | Turn effective state into weighted prompts and blend changes |
| `classifyKey`, `LYRIA_SCALES`                                                        | Map a GAS key to the nearest Lyria scale                     |
| `LyriaConnectorConfig`, `WeightedPrompt`, `PromptTransition`, `KeyClassification`, … | The type families above                                      |
| `version`                                                                            | This package's version                                       |

## Settings

`Renderer.open` passes the connector its settings, which are:

```ts
import type { LyriaConnectorSettings } from '@luna-estelar/gas-lyria';

const settings: LyriaConnectorSettings = { apiKey: 'a key authorized for Lyria' };
```

`endpoint` is optional: any HTTPS origin that speaks the Lyria WebSocket protocol, for sending the
same request somewhere other than Google. It is reduced to its origin and rejected outright if it
carries userinfo, a query, a fragment or a path, so a credential cannot hide in it.

How an application obtains a key is the application's own concern. This package neither stores a
key nor provides a way to fetch one; it hands the value it is given to the transport and nothing
else.

## Configuration

`validateLyriaConfig` checks a proposed configuration against the same options
`LYRIA_CONFIG_SCHEMA` describes, by hand and without compiling anything. It is the connector's
`Connector.validateConfig` implementation, which is how the Renderer validates configuration edits
under a Content Security Policy without `'unsafe-eval'`. It reports every problem at once, each as
a JSON Pointer `path`, one of the codes `wrong-type`, `out-of-range`, `not-allowed` or
`unknown-member`, and fixed text describing the rule.

## Close codes

The connector classifies the standard WebSocket close codes and passes the raw number through as
`closeCode` on the failure, all the way to the host:

| Close code                 | Failure                  | Reason     | Retryable |
| -------------------------- | ------------------------ | ---------- | --------- |
| 1007 or 1008, before setup | `lyria-auth-rejected`    | `auth`     | no        |
| 1002 or 1011               | `lyria-provider-failure` | `provider` | yes       |
| anything else              | `lyria-network-failure`  | `network`  | yes       |

Application close codes (4000-4999) belong to whoever is serving the endpoint, so they are reported
as network failures and passed through as `closeCode` for the host to interpret. The connector never
invents a meaning for one.

## What Lyria can and cannot do

The connector reports these capability levels:

| Intent                             | Lyria        |
| ---------------------------------- | ------------ |
| `flavor`, `tempo`, `timbre`        | supported    |
| `key`, `level`                     | approximated |
| `time_signature`, `notes`, `motif` | unsupported  |

Unsupported intents remain in the compiled timeline and session state. GAS reports capability
warnings for intents the connector cannot render.

## Manual checks

Opening the Lyria transport requires a key and network access; compilation and state derivation
run locally. The
[manual listening and transport guide](https://github.com/luna-estelar/gas/tree/main/packages/lyria/manual)
covers provider checks that the automated tests cannot make.

## Runtime support

- ESM-only.
- Node.js 22 or newer; runs in browsers.
- Uses the official `@google/genai` SDK, its only dependency; GAS itself is a peer.

## Related packages

Pass it to `createRenderer` from `@luna-estelar/gas` or `createBrowserSession` from
`@luna-estelar/gas/browser`. Neither depends on this package, so you can swap in another
connector.

## License

MIT
