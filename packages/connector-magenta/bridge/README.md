# Magenta bridge

`gas_magenta_bridge.py` loads a Magenta RealTime 2 model once and serves it to the GAS Magenta
connector over a WebSocket on loopback. It is one file with two dependencies, `magenta-rt` and
`websockets`.

## Hardware

MRT2 streams in real time only on Apple Silicon:

| Model        | Size | Real time on                                |
| ------------ | ---- | ------------------------------------------- |
| `mrt2_small` | 230M | Any Apple Silicon Mac, including Air models |
| `mrt2_base`  | 2.4B | M2 Max, M3 Max, M4 Pro, M5 Max or better    |

The JAX backend runs both models on Linux with an NVIDIA GPU, and on a plain CPU, but slower than
real time. The bridge warns once (`behind-real-time`) when a chunk takes longer to generate than
to play. Offline rendering (see `../manual`) still works at any speed.

## Run

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install "magenta-rt[mlx]" websockets        # Linux: "magenta-rt[jax]"
mrt models init                                 # MusicCoCa and SpectroStream
mrt models download mrt2_small                  # exported MLX model, for --backend mlx
mrt checkpoints download mrt2_small             # raw checkpoint, for --backend jax
python gas_magenta_bridge.py --model mrt2_small
```

Models land in `~/Documents/Magenta/magenta-rt-v2`, or under `$MAGENTA_HOME`. If Hugging Face is
unreachable, `MAGENTA_RT_DOWNLOAD_SOURCE=gcs` downloads from Google Cloud Storage instead.

| Option               | Default        | Meaning                                                   |
| -------------------- | -------------- | --------------------------------------------------------- |
| `--model`            | `mrt2_small`   | `mrt2_small` or `mrt2_base`                               |
| `--backend`          | `auto`         | `mlx` (exported) on Apple Silicon, `jax` elsewhere        |
| `--port`             | `8765`         | The connector's default endpoint is `ws://127.0.0.1:8765` |
| `--chunk-frames`     | `10`           | Frames per audio message; 25 frames is one second         |
| `--musiccoca-levels` | `6`            | Coarse style levels kept, as the official apps do         |
| `--allow-origin`     | localhost only | A browser origin allowed to connect (glob), repeatable    |
| `--token-env`        | none           | Require the token held in this environment variable       |

## Security

The bridge listens on `127.0.0.1` by default. Browsers send an `Origin` header with every
WebSocket, and the bridge refuses any origin not on its list, so a page you happen to visit cannot
drive your model. To let a hosted page use your bridge, allow that one origin, for example
`--allow-origin https://gas.lunaestelar.com`. Clients without an `Origin`, such as Node, are
accepted; use `--token-env` when that is not acceptable.

Every message is validated, and the bridge never reads a path, URL or code from a client. Model
failures reach the client as a fixed code; the detail stays in the bridge's own log.

## Tests

```bash
pip install pytest pytest-asyncio
python -m pytest
```

The tests use a fake engine, so they need neither model weights nor `magenta-rt`'s heavy
dependencies beyond `numpy` and `websockets`. The protocol is in [PROTOCOL.md](./PROTOCOL.md).
