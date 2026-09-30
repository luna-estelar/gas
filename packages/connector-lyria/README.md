# GAS Lyria Connector

`@luna-estelar/gas-connector-lyria` connects GAS to Google's Lyria RealTime through prompt
translation, transport, chunk pacing and configuration.

## Install

```bash
npm install @luna-estelar/gas-connector-lyria
```

The package is ESM-only, requires Node.js 20 or newer when used in Node, and uses the official
`@google/genai` transport. Opening a connector requires a key authorized for Lyria.

The connector depends on GAS Protocol and the Google transport SDK. Public protocol contracts
use vendor-independent types.

The package root exports `createLyriaConnector`, `LYRIA_CAPABILITIES`, `translatePrompts`,
`createPromptTransition`, `classifyKey`, `LYRIA_SCALES`, `resolveLyriaConfig`,
`validateLyriaConfig`, `LYRIA_CONFIG_SCHEMA`, `DEFAULT_LYRIA_CONFIG`, and the
`LyriaConnectorSettings` type.

```ts
import { createLyriaConnector } from '@luna-estelar/gas-connector-lyria';

const connector = createLyriaConnector();
const description = await connector.describe();
console.log(description.model.displayName);
```

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

## Dependencies

Opening the Lyria transport requires a key and network access. Compilation and state
derivation run locally. See the
[manual listening and transport guide](https://github.com/luna-estelar/gas/tree/main/packages/connector-lyria/manual)
for provider checks.

The connector depends on `@google/genai`. Installing the browser host also installs this connector.
