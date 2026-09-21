# Manual listening and transport checks

## BYOK listening comparison

This manual command is intentionally outside the automated test gate. It uses the pinned official
Google SDK for a direct-BYOK comparison and requires an authorized `GEMINI_API_KEY` environment
variable. Never pass a key on the command line or place it in a fixture.

```sh
GEMINI_API_KEY=... \
pnpm --filter @luna-estelar/gas-connector-lyria manual:listen \
  --fixture /absolute/path/to/example.gas \
  --strategy global-plus-tracks \
  --seed 42 \
  --duration 30 \
  --out /absolute/path/to/ignored-listening
```

The harness compiles the fixture, captures raw PCM16LE/48 kHz/stereo, and writes a WAV plus a JSON
manifest containing the normalized prompts and safe model configuration. It never records the API
key, a proxy URL, raw vendor messages, or a user IP. Keep the output directory ignored and outside
the repository.

The authorized seed-47 matrix was auditioned on 2026-07-21. The selected captures all contained
non-zero PCM; two short or empty per-track takes were replaced before review. The human decisions
were:

| Case | Fixture/change                                | Decision         |
| ---- | --------------------------------------------- | ---------------- |
| 1    | One track with global mood                    | Global better    |
| 2    | Two contrasting tracks with asymmetric levels | Per-track better |
| 3    | Live flavor/timbre change                     | Global better    |
| 4    | Activation and deactivation                   | Inconclusive     |
| 5    | Interrupted crossfade                         | Global better    |
| 6a   | Native major/minor key                        | Both acceptable  |
| 6b   | Modal key                                     | Both acceptable  |

Excluding the inconclusive activation/deactivation case and the two ties, `global-plus-tracks`
won three comparisons to one. That result selects `global-plus-tracks` as the connector default;
`per-track` remains available as an explicit configuration. No additional paid rerun was made for
case 4.

The checked-in fixtures under `manual/fixtures/` map to the numbered rows. Row 6 uses `06a` and
`06b` so the native scale path and modal prompt-context path can be compared independently.

## Transport smoke

The transport smoke exercises the concrete connector lifecycle, prompt/config update, flow pause,
resume, stop, and close. It makes real provider calls and must be run only with authorized settings.
It accepts connection settings only through the environment and never records them.

Direct BYOK:

```sh
GAS_LYRIA_ACCESS_MODE=byok \
GAS_LYRIA_API_KEY=... \
GAS_LYRIA_SMOKE_OUTPUT=/absolute/path/to/ignored-smoke.wav \
pnpm --filter @luna-estelar/gas-connector-lyria manual:smoke
```

Hosted access through an already-deployed, allowlisted Worker:

```sh
GAS_LYRIA_ACCESS_MODE=hosted \
GAS_LYRIA_PROXY_BASE_URL=https://music-proxy.example \
GAS_LYRIA_SMOKE_OUTPUT=/absolute/path/to/ignored-smoke.wav \
pnpm --filter @luna-estelar/gas-connector-lyria manual:smoke
```

`GAS_LYRIA_SMOKE_OUTPUT` is optional. The script otherwise retains chunks only in memory and reports
their count and duration. Do not run either command in CI, deploy a Worker from this command, or
attach the resulting audio to a public issue without reviewing it.
