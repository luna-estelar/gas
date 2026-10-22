# Manual rendering

`render.mjs` drives the real connector against a running bridge and writes a WAV. It applies each
authored change when the received audio reaches that bar, not by the wall clock, so a machine that
generates slower than real time still renders the arrangement as written. It is outside the
automated gate because it needs a model.

```sh
# Terminal 1: the bridge (see ../bridge/README.md)
python packages/connector-magenta/bridge/gas_magenta_bridge.py --model mrt2_small

# Terminal 2
pnpm build
pnpm --filter @luna-estelar/gas-connector-magenta manual:render \
  --fixture manual/fixtures/01-chord-change.gas \
  --duration 8 \
  --out /absolute/path/to/ignored/render.wav
```

`--endpoint` points at another bridge, `--config` reads a connector configuration from a JSON
file, and `GAS_MAGENTA_TOKEN` supplies the token for a bridge started with `--token-env`.

## Checked results

On 2026-10-22 `01-chord-change.gas` rendered 8 s with `mrt2_small` on the JAX CPU backend (a
4-core Linux container, 0.08x real time). The strongest partial was C4 (262 Hz) through bar 2,
matching `o4 c e g`, and A3 (220 Hz) appeared after the bar 3 change to `o3 a > c e`. That
confirms prompts, pitches and updates reach the model; it says nothing about how it sounds on an
Apple Silicon Mac with `mrt2_base`, which needs a listening pass of its own.
