# GAS Lyria Connector

`@luna-estelar/gas-connector-lyria` connects GAS to Google's Lyria RealTime through prompt
translation, transport, chunk pacing, authentication inputs, and configuration.

## Install

```bash
npm install @luna-estelar/gas-connector-lyria
```

The package is ESM-only, requires Node.js 20 or newer when used in Node, and uses the official
`@google/genai` transport. Opening a connector requires authorized Lyria access.

The connector depends on GAS Protocol and the Google transport SDK. Public protocol contracts
use vendor-independent types.

The package root exports `createLyriaConnector`, `LYRIA_CAPABILITIES`, `translatePrompts`,
`createPromptTransition`, `classifyKey`, `LYRIA_SCALES`, `resolveLyriaConfig`,
`LYRIA_CONFIG_SCHEMA`, and `DEFAULT_LYRIA_CONFIG`.

```ts
import { createLyriaConnector } from '@luna-estelar/gas-connector-lyria';

const connector = createLyriaConnector();
const description = await connector.describe();
console.log(description.model.displayName);
```

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

Opening the Lyria transport requires credentials and network access. Compilation and state
derivation run locally. See the
[manual listening and transport guide](https://github.com/luna-estelar/gas/tree/main/packages/connector-lyria/manual)
for provider checks.

The connector depends on `@google/genai`. Installing the browser host also installs this connector.
