# @luna-estelar/gas-connector-magenta

Connects GAS to Google's open-weights [Magenta RealTime 2](https://github.com/magenta/magenta-realtime)
(MRT2): style prompts, pitches from `notes` and `motif`, transport and configuration. It is the
connector stage of `document → language → timeline → session → renderer → connector → model`.

MRT2 runs on the listener's own machine, not behind a hosted API, and has no network interface of
its own. This package therefore ships two halves: the connector, which runs wherever GAS runs, and
a small Python bridge in [`bridge/`](https://github.com/luna-estelar/gas/tree/main/packages/connector-magenta/bridge)
that loads the model and streams its audio to the connector over a loopback WebSocket.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-connector-magenta)](https://www.npmjs.com/package/@luna-estelar/gas-connector-magenta)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas-connector-magenta)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/release.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/release.yml)

## Install

```bash
npm install @luna-estelar/gas-connector-magenta
```

Part of `@luna-estelar/gas`, which installs every package; there it is the `/magenta` subpath.

Then start the bridge on the machine that will generate audio:

```bash
pip install "magenta-rt[mlx]" websockets   # on Linux with an NVIDIA GPU: magenta-rt[jax]
mrt models init && mrt models download mrt2_small
python node_modules/@luna-estelar/gas-connector-magenta/bridge/gas_magenta_bridge.py
```

See the [bridge guide](https://github.com/luna-estelar/gas/tree/main/packages/connector-magenta/bridge)
for models, hardware and options.

## Example

```ts
import { createMagentaConnector } from '@luna-estelar/gas-connector-magenta';

const connector = createMagentaConnector();
const description = await connector.describe();
console.log(description.model.displayName);
```

A host passes the connector to `createRenderer` (or to `@luna-estelar/gas-browser`'s
`createBrowserSession`) together with its settings. Starting it requires a running bridge.

## Exports

| Export                                                                           | Purpose                                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `createMagentaConnector`                                                         | Create a Magenta connector                                  |
| `MAGENTA_CAPABILITIES`                                                           | What Magenta renders, approximates and cannot render        |
| `MagentaConnectorSettings`                                                       | The settings type: `{ endpoint?, token? }`                  |
| `validateMagentaConfig`, `resolveMagentaConfig`                                  | Check a configuration, or resolve one with defaults applied |
| `MAGENTA_CONFIG_SCHEMA`, `DEFAULT_MAGENTA_CONFIG`                                | The configuration surface as JSON Schema, and its defaults  |
| `translatePrompts`, `selectPitches`                                              | Turn effective state into weighted prompts and pitches      |
| `MAGENTA_BRIDGE_PROTOCOL`, `MAGENTA_DEFAULT_ENDPOINT`                            | The bridge protocol version and default address             |
| `MagentaConnectorConfig`, `WeightedPrompt`, `PromptContext`, `PitchSelection`, … | The type families above                                     |
| `version`                                                                        | This package's version                                      |

## Settings

```ts
import type { MagentaConnectorSettings } from '@luna-estelar/gas-connector-magenta';

const settings: MagentaConnectorSettings = { endpoint: 'ws://127.0.0.1:8765' };
```

Both members are optional. `endpoint` defaults to `ws://127.0.0.1:8765`; plain `ws:` is accepted
only for `localhost`, `127.0.0.1` and `[::1]`, and any other host must use `wss:`. It is reduced to
its origin and rejected if it carries userinfo, a query, a fragment or a path. `token` is sent to
the bridge in its first message when the bridge was started with `--token-env`, and nowhere else.

## Configuration

`validateMagentaConfig` checks a proposed configuration by hand, without compiling anything, and
reports every problem at once with the codes `wrong-type`, `out-of-range`, `not-allowed` or
`unknown-member`. The generation defaults are the ones the official MRT2 engine ships with:
temperature 1, top-k 100, style guidance 3 and notes guidance 5. `generation.drums` is `auto`, `on`
or `off`.

## What Magenta can and cannot do

| Intent                  | Magenta      |
| ----------------------- | ------------ |
| `flavor`, `timbre`      | supported    |
| `tempo`, `key`, `level` | approximated |
| `notes`, `motif`        | approximated |
| `time_signature`        | unsupported  |

Style is a weighted blend of text prompts, so `level` becomes a prompt weight. MRT2 has no tempo or
key control, so both are described in words in the global prompt (`describeTempo`, `describeKey`).
`notes` and `motif` give the model their pitches and it places the onsets itself, the engine's
auto-strum mode: the harmony follows the notation, the rhythm does not.

## Close codes

| Close code                    | Failure                      | Reason     | Retryable |
| ----------------------------- | ---------------------------- | ---------- | --------- |
| any, before the socket opened | `magenta-bridge-unreachable` | `network`  | yes       |
| 1008, before ready            | `magenta-auth-rejected`      | `auth`     | no        |
| 1002, 1003 or 1009            | `magenta-protocol-rejected`  | `internal` | no        |
| 1011                          | `magenta-generation-failed`  | `provider` | yes       |
| anything else                 | `magenta-network-failure`    | `network`  | yes       |

`magenta-bridge-unreachable` usually means the bridge is not running. Application close codes
(4000-4999) are passed through as `closeCode` for the host to interpret.

## Manual checks

The [manual guide](https://github.com/luna-estelar/gas/tree/main/packages/connector-magenta/manual)
renders a `.gas` document through a running bridge to a WAV file.

## Runtime support

- ESM-only.
- Node.js 22 or newer, which has a global `WebSocket`; runs in browsers.
- A browser page can reach a loopback bridge only from an origin the bridge allows (`--allow-origin`).
- No dependencies outside GAS. The bridge needs Python 3.11+, `magenta-rt` and `websockets`.

## Related packages

Depends on `@luna-estelar/gas-protocol` and `@luna-estelar/gas-notation`. Works with any host that
accepts a `Connector`, such as `@luna-estelar/gas-renderer` or `@luna-estelar/gas-browser`.

## License

MIT. Magenta RealTime 2 and its weights are Google's, under their own licenses.
