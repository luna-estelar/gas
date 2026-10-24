# @luna-estelar/gas-magenta-rt2

Plays [GAS](https://gas.lunaestelar.com) through
[Magenta RealTime 2](https://github.com/magenta/magenta-realtime), Google's open-weights live music
model, running on your own machine or server.

The model does not run in this package. It runs in **mrt2-bridge**, a small native server that
loads the model once and streams audio over a WebSocket; this package is the GAS connector that
talks to it. Nothing here needs an API key, and nothing is sent to Google.

```bash
npm install @luna-estelar/gas @luna-estelar/gas-magenta-rt2
```

## Start a bridge

The bridge needs an Apple Silicon Mac: upstream real-time generation is Apple Silicon only.
Build and run it as its README describes, then:

```bash
./build/mrt2-bridge --model mrt2_small     # listens on ws://127.0.0.1:8765
```

## Connect

```ts
import { createBrowserSession } from '@luna-estelar/gas/browser';
import { createMagentaRt2Connector } from '@luna-estelar/gas-magenta-rt2';

const browser = await createBrowserSession({
  connector: () => createMagentaRt2Connector(),
  settings: { endpoint: 'ws://127.0.0.1:8765' }
});
```

`createMagentaRt2Connector()` uses the platform's `WebSocket`, so it works in browsers and in
Node 22 or newer.

### Settings

```ts
import type { MagentaRt2ConnectorSettings } from '@luna-estelar/gas-magenta-rt2';
```

| Setting    | Meaning                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `endpoint` | `ws://` for a bridge on this machine (`localhost`, `127.0.0.1`, `[::1]`), otherwise `wss://`. A path is allowed for a gateway; a query, fragment or credentials are not. |
| `token`    | Optional. Sent in the first message when the bridge runs with `--token`.                                                                                                 |

A page served over HTTPS may be blocked from opening `ws://` to a local bridge by the browser's
mixed-content or private-network rules. Serve the page from `localhost` while developing, or put the
bridge behind `wss://`.

## Configuration

| Option                   | Default | Range  | Meaning                                      |
| ------------------------ | ------- | ------ | -------------------------------------------- |
| `prompt.globalWeight`    | `1`     | 0–10   | Weight of the global prompt; 0 leaves it out |
| `prompt.trackWeight`     | `1`     | 0–10   | Weight of a track at level 1                 |
| `generation.temperature` | engine  | 0–4    | Sampling temperature                         |
| `generation.topK`        | engine  | 1–1024 | Top-k sampling                               |
| `connectTimeoutSeconds`  | `10`    | 1–120  | Connect, greet and start before giving up    |

`validateMagentaRt2Config` checks a configuration by hand, without compiling the schema, and is the
connector's `validateConfig`.

## What Magenta RT2 can and cannot do

| Intent                             | Magenta RT2  |
| ---------------------------------- | ------------ |
| `flavor`, `timbre`                 | supported    |
| `level`, `key`, `tempo`            | approximated |
| `time_signature`, `notes`, `motif` | unsupported  |

MRT2 is steered by a blend of up to six text prompts. Each run translates GAS state the same way:

- The global description, key and tempo become one prompt, for example
  `late night. In A minor. 90 BPM.` Key and tempo fall back to the run's defaults, including
  any the host set, and tempo is stated in quarter-note BPM, so 120 in 6/8 reads `60 BPM`. The
  model has no native key or tempo control, so these are suggestions in words and it may not
  follow them.
- Each active track becomes a prompt from its description, flavor and timbre, weighted by its
  level. Level changes the track's share of the blend, not its volume in the mix: MRT2 generates
  one mixed stream, with no separate stems.
- Tracks are ordered heaviest first. If more are active than there are slots, the extra tracks
  share the last slot and the connector warns once with `magenta-rt2-prompt-overflow`. Every
  track's weight still counts toward that slot.
- Each prompt is limited to 512 bytes of UTF-8, the bridge's limit. Longer text is cut at a word
  break and the connector warns once with `magenta-rt2-prompt-truncated`. When folded tracks do
  not all fit, the slot keeps as many whole descriptions as fit.
- With no active track, generation pauses and resumes when one returns.

When only weights change, the bridge re-blends cached text embeddings, which is fast. New text has
to be encoded first, which takes noticeably longer.

## Audio and timing

The bridge sends 160 ms packets of 48 kHz stereo 16-bit PCM, paced to real time plus a one-second
lead. The renderer's lookahead is one packet (160 ms), so set the browser's `prebufferSeconds` and
the renderer's `firstAudioTimeoutSeconds` explicitly if your network or machine needs more room.
Measured behaviour on real hardware is recorded in the [manual guide](./manual/README.md).

## Failures

| Code                               | Reason     | Retryable | When                                                              |
| ---------------------------------- | ---------- | --------- | ----------------------------------------------------------------- |
| `magenta-rt2-connect-timeout`      | `network`  | yes       | Not connected, greeted and started within `connectTimeoutSeconds` |
| `magenta-rt2-network-failure`      | `network`  | yes       | The connection closed; carries `closeCode`                        |
| `magenta-rt2-command-timeout`      | `network`  | yes       | The bridge did not answer a command within 20 seconds             |
| `magenta-rt2-auth-rejected`        | `auth`     | no        | Wrong token, or origin not allowed                                |
| `magenta-rt2-engine-failure`       | `provider` | yes       | The engine stopped producing audio                                |
| `magenta-rt2-prompt-encode-failed` | `provider` | yes       | The text encoder could not encode a prompt                        |
| `magenta-rt2-protocol-violation`   | `provider` | no        | The bridge spoke another protocol or format                       |
| `magenta-rt2-command-rejected`     | `internal` | no        | The bridge refused a command as invalid                           |

A bridge serving another session is retried every 0.1 seconds until `connectTimeoutSeconds`, then the
start fails with `magenta-rt2-connect-timeout`. The bridge closes a connection that has not started
generation within 30 seconds (close code `4408`), so a run whose first 30 seconds have no active track
fails with `magenta-rt2-network-failure`.

`stop()` and `close()` settle a start still connecting with `magenta-rt2-start-cancelled`, which is
not a provider failure.

## License

MIT. Magenta RealTime 2's code and weights have their own licenses upstream.
