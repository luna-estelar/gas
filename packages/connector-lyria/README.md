# @luna-estelar/gas-connector-lyria

Connects GAS to Google's Lyria RealTime: prompt translation, transport, chunk pacing and
configuration. It is the connector stage of `document → language → timeline → session → renderer
→ connector → model`.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-connector-lyria)](https://www.npmjs.com/package/@luna-estelar/gas-connector-lyria)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas-connector-lyria)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/ci.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/ci.yml)

## Install

```bash
npm install @luna-estelar/gas-connector-lyria
```

Part of `@luna-estelar/gas`, which installs every package; there it is the `/lyria` subpath.

## Example

```ts
import { createLyriaConnector } from '@luna-estelar/gas-connector-lyria';

const connector = createLyriaConnector();
const description = await connector.describe();
console.log(description.model.displayName);
```

A host passes the connector to `createRenderer` (or to `@luna-estelar/gas-browser`'s
`createBrowserSession`) together with its settings. Opening it requires a key authorized for Lyria.

## Exports

| Export                                                                               | Purpose                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `createLyriaConnector`                                                               | Create a Lyria connector                                     |
| `LYRIA_CAPABILITIES`                                                                 | What Lyria renders, approximates and cannot render           |
| `LyriaConnectorSettings`                                                             | The settings type: `{ apiKey, endpoint? }`                   |
| `validateLyriaConfig`, `resolveLyriaConfig`                                          | Check a configuration, or resolve one with defaults applied  |
| `LYRIA_CONFIG_SCHEMA`, `DEFAULT_LYRIA_CONFIG`                                        | The configuration surface as JSON Schema, and its defaults   |
| `translatePrompts`, `createPromptTransition`                                         | Turn effective state into weighted prompts and blend changes |
| `classifyKey`, `LYRIA_SCALES`                                                        | Map a GAS key to the nearest Lyria scale                     |
| `LyriaConnectorConfig`, `WeightedPrompt`, `PromptTransition`, `KeyClassification`, … | The type families above                                      |
| `packageName`, `version`                                                             | This package's name and version                              |

## Settings

`Renderer.open` passes the connector its settings, which are:

```ts
import type { LyriaConnectorSettings } from '@luna-estelar/gas-connector-lyria';

const settings: LyriaConnectorSettings = { apiKey: 'a key authorized for Lyria' };
```

`endpoint` is optional: any HTTPS origin that speaks the Lyria WebSocket protocol, for sending the
same request somewhere other than Google. It is reduced to its origin and rejected outright if it
carries userinfo, a query, a fragment or a path, so a credential cannot hide in it.

How an application obtains a key is the application's own concern. This package neither stores a
key nor provides a way to fetch one; it hands the value it is given to the transport and nothing
else.

## Configuration

`validateLyriaConfig` checks a proposed configuration against the same surface
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
[manual listening and transport guide](https://github.com/luna-estelar/gas/tree/main/packages/connector-lyria/manual)
covers provider checks that the automated tests cannot make.

## Runtime support

- ESM-only.
- Node.js 20 or newer; runs in browsers.
- Uses the official `@google/genai` transport, which is the only dependency outside GAS. Import
  this package only where a connector is needed, since that is where the SDK loads.

## Related packages

Depends on `@luna-estelar/gas-protocol` and `@google/genai`. Works with any host that accepts a
`Connector`, such as `@luna-estelar/gas-renderer` or `@luna-estelar/gas-browser`, which takes the
connector as an argument and does not depend on this package.

## License

MIT
