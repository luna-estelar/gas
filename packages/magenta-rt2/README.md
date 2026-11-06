# @luna-estelar/gas-magenta-rt2

Plays [GAS](https://gas.lunaestelar.com) through
[Magenta RealTime 2](https://github.com/magenta/magenta-realtime), Google's open-weights live music
model, running on your own machine or server.

The model doesn't run in this package. It runs in **mrt2-bridge**, a small native server that loads
the model once and streams audio over a WebSocket. This package is the GAS connector that talks to
it. It needs no API key, and nothing is sent to Google.

## Install

```bash
npm install @luna-estelar/gas @luna-estelar/gas-magenta-rt2
```

`@luna-estelar/gas` is a peer dependency.

## Example

```ts
import { createSession } from '@luna-estelar/gas';
import { createMagentaRt2Connector } from '@luna-estelar/gas-magenta-rt2';

const session = await createSession({
  connector: createMagentaRt2Connector({ endpoint: 'ws://127.0.0.1:8765' })
});
```

In a browser, pass the connector to `createBrowserSession` from `@luna-estelar/gas/browser`
instead. The connector uses the platform's `WebSocket`, so it works in browsers and in Node 22 or
newer.

## Start a bridge

The bridge needs an Apple Silicon Mac, because upstream real-time generation is Apple Silicon only.
Build it as its README describes, then run:

```bash
./build/mrt2-bridge --model mrt2_small     # listens on ws://127.0.0.1:8765
```

Use a bridge that advertises `keepalive` in its hello (mrt2-bridge `ff7ea0c` or later). An older
bridge closes a socket that has played nothing for 30 s, so a piece that opens with a long rest
fails with `magenta-rt2-idle-timeout`. The connector warns `magenta-rt2-no-keepalive` when it
connects to one.

## Options

- `endpoint`: `ws://` for a bridge on this machine (`localhost`, `127.0.0.1`, `[::1]`), otherwise
  `wss://`. A path is allowed for a gateway. A query, fragment or credentials are not.
- `token`: optional. Sent in the first message, for a bridge started with `MRT2_BRIDGE_TOKEN`.
- `translate`: optional hook, below.

`createMagentaRt2Connector` throws `magenta-rt2-invalid-settings` for a bad option.

A page served over HTTPS may be blocked from opening `ws://` to a local bridge by the browser's
mixed-content or private-network rules. Serve the page from `localhost` while developing, or put the
bridge behind `wss://`.

## Changing the translation

`translate` turns the session's state into at most six weighted prompts. An empty list means nothing
plays, and generation pauses. The default is exported, so a hook can wrap it:

```ts
import { createMagentaRt2Connector, translatePrompts } from '@luna-estelar/gas-magenta-rt2';

const connector = createMagentaRt2Connector({
  endpoint: 'ws://127.0.0.1:8765',
  translate: (state, config, timing) =>
    translatePrompts(timing, state, config.prompt).prompts.map((p) => ({
      ...p,
      text: `${p.text} Lo-fi.`
    }))
});
```

If the hook throws or returns a prompt the bridge would refuse, the change fails with
`magenta-rt2-translate-failed`. A variant that sounds different should use its own id:
`{ ...MAGENTA_RT2_DESCRIPTION, id: 'my-magenta' }`. For a connector of your own,
`openMagentaRt2Session` is the transport on its own.

## Configuration

| Option                   | Default | Range  | Meaning                                      |
| ------------------------ | ------- | ------ | -------------------------------------------- |
| `prompt.globalWeight`    | `1`     | 0–10   | Weight of the global prompt; 0 leaves it out |
| `prompt.trackWeight`     | `1`     | 0–10   | Weight of a track at level 1                 |
| `generation.temperature` | engine  | 0–4    | Sampling temperature                         |
| `generation.topK`        | engine  | 1–1024 | Top-k sampling                               |
| `connectTimeoutSeconds`  | `10`    | 1–120  | Connect and greet before giving up           |

## What Magenta RT2 can and cannot do

| Intent                             | Magenta RT2  |
| ---------------------------------- | ------------ |
| `flavor`, `timbre`                 | supported    |
| `level`, `key`, `tempo`            | approximated |
| `time_signature`, `notes`, `motif` | unsupported  |

MRT2 is steered by a blend of up to six text prompts. The default translation:

- The global description, key and tempo become one prompt, for example
  `late night. In A minor. 90 BPM.` Tempo is in quarter-note BPM, so 120 in 6/8 reads `60 BPM`.
  The model has no native key or tempo control, so it may not follow them.
- Each active track becomes a prompt from its description, flavor and timbre, weighted by its
  level. Level changes the track's share of the blend, not its volume. MRT2 makes one mixed stream.
- Tracks go heaviest first. If more are active than there are slots, the extra tracks share the
  last slot, and the connector warns `magenta-rt2-prompt-overflow` once.
- Each prompt is cut to 512 bytes of UTF-8 at a word break, and the connector warns
  `magenta-rt2-prompt-truncated` once.

The bridge session starts with the first prompts to play. Until then, the connector sends a
keepalive every 10 s. With no active track, and whenever GAS pauses for a rest, generation pauses.

A change that only moves weights is quick, because the bridge re-blends cached text embeddings. New
text has to be encoded first, which takes noticeably longer.

## Audio

The bridge sends 160 ms packets of 48 kHz stereo 16-bit PCM, paced to real time plus a one-second
lead. The [manual guide](./manual/README.md) records measurements.

## Failures

| Code                               | Reason     | Retryable | When                                                       |
| ---------------------------------- | ---------- | --------- | ---------------------------------------------------------- |
| `magenta-rt2-connect-timeout`      | `network`  | yes       | Not connected and greeted within `connectTimeoutSeconds`   |
| `magenta-rt2-busy`                 | `provider` | yes       | The bridge served another session until the timeout (4409) |
| `magenta-rt2-network-failure`      | `network`  | yes       | The connection closed                                      |
| `magenta-rt2-idle-timeout`         | `network`  | yes       | The bridge closed an idle socket (4408)                    |
| `magenta-rt2-command-timeout`      | `network`  | yes       | The bridge didn't answer a command within 20 s             |
| `magenta-rt2-auth-rejected`        | `auth`     | no        | Wrong token, or origin not allowed (4401, 4403)            |
| `magenta-rt2-engine-failure`       | `provider` | yes       | The engine stopped producing audio (4500)                  |
| `magenta-rt2-prompt-encode-failed` | `provider` | yes       | The text encoder couldn't encode a prompt                  |
| `magenta-rt2-protocol-violation`   | `provider` | no        | The bridge spoke another protocol or format (4400)         |
| `magenta-rt2-command-rejected`     | `internal` | no        | The bridge refused a command as invalid                    |

Each carries the socket's `closeCode` when there is one. A bridge serving another session is retried
every 0.1 s until `connectTimeoutSeconds`.

## License

MIT. Magenta RealTime 2's code and weights have their own licenses upstream.
