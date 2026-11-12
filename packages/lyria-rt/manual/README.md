# Manual listening and transport checks

## Listening comparison

This manual command is intentionally outside the automated test gate. It uses the pinned official
Google SDK directly and requires an authorized `GAS_LYRIA_RT_API_KEY` environment
variable. Never pass a key on the command line or place it in a fixture.

```sh
GAS_LYRIA_RT_API_KEY=... \
pnpm --filter @luna-estelar/gas-lyria-rt manual:listen \
  --fixture /absolute/path/to/example.gas \
  --strategy global-plus-tracks \
  --share 0.5 \
  --seed 47 \
  --duration 30 \
  --out /absolute/path/to/ignored-listening
```

The harness compiles the fixture, captures raw PCM16LE/48 kHz/stereo, and writes a WAV plus a JSON
manifest containing the normalized prompts and safe model configuration. It never records the API
key, a proxy URL, raw vendor messages, or a user IP. Keep the output directory ignored and outside
the repository.

`--guidance` (0 to 6), `--transition-ms` and `--transition-steps` override the connector defaults
for a take.

The authorized seed-47 matrix was auditioned on 2026-07-21. The selected captures all contained
non-zero PCM; two short or empty per-track takes were replaced before review. Results:

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

Those takes had one or two tracks and a fixed global weight of 0.8. In a fuller score that left
the mood at about a fifth of the mix, so the default is now `globalShare: 0.5`: the mood holds half
the mix however many tracks play. `--share` overrides it for a take; `--share 0.2` is close to
what a four-track score got before.

On 2026-11-13 a four-track score with one change per section was captured at shares 0.3, 0.5 and
0.65, `per-track`, guidance 5 and 6, and a 6 s crossfade. The score was accepted by ear. No setting
was picked over the defaults, so they stand.

Before that date the script's timer fired every crossfade step at once, so earlier takes switched
prompts instantly.

The checked-in fixtures under `manual/fixtures/` map to the numbered rows. Row 6 uses `06a` and
`06b` so the native scale path and modal prompt-context path can be compared independently.

## Transport smoke

The smoke plays a document through `createSession`, changes its tempo and flavor, stops, plays
again and closes, and fails unless both Plays got audio. It makes real provider calls and must be run only with authorized settings.
It accepts connection settings only through the environment and never records them.

```sh
GAS_LYRIA_RT_API_KEY=... \
GAS_LYRIA_RT_SMOKE_OUTPUT=/absolute/path/to/ignored-smoke.wav \
pnpm --filter @luna-estelar/gas-lyria-rt manual:smoke
```

`GAS_LYRIA_RT_ENDPOINT` is optional and sends the same request to another HTTPS origin that speaks
the Lyria RealTime WebSocket protocol, for checking a deployment of your own.
`GAS_LYRIA_RT_SMOKE_OUTPUT` is also optional; without it the script keeps chunks only in memory
and reports their count and duration.
Do not run this command in CI or attach the resulting audio to a public issue without reviewing it.

## Start-up delay

The startup script measures how long Lyria RealTime takes to send audio after it opens and after it
resumes from a pause. It uses `openLyriaRtSession` directly, so the numbers don't include GAS. Each
run plays, then pauses for 2, 4 and 8 s and resumes with new prompts. It makes real provider calls,
and takes about 40 s a run.

```sh
GAS_LYRIA_RT_API_KEY=... \
GAS_LYRIA_RT_STARTUP_RUNS=10 \
GAS_LYRIA_RT_STARTUP_OUTPUT=/absolute/path/to/ignored-startup.json \
pnpm --filter @luna-estelar/gas-lyria-rt manual:startup
```

It prints min, median, p90, p95 and max for each measure. `GAS_LYRIA_RT_STARTUP_OUTPUT` is optional
and writes the raw samples too. The connector's `startupDelaySeconds` covers the slowest resume measured.

## Reaction to a prompt change

The reaction script measures how late a prompt change lands in the audio while the model keeps
playing. It plays one prompt, switches to another in a single send, and reads which prompts each
chunk says it was generated from. It uses the Google SDK directly and makes real provider calls,
about 40 s a run.

```sh
GAS_LYRIA_RT_API_KEY=... \
GAS_LYRIA_RT_REACTION_RUNS=5 \
GAS_LYRIA_RT_REACTION_OUTPUT=/absolute/path/to/ignored-reaction.json \
pnpm --filter @luna-estelar/gas-lyria-rt manual:reaction
```

It prints two measures. `reactionAudioSeconds` is how much audio the model had already sent when the
first chunk made from the new prompts began. `leadSeconds` is how far the audio received runs ahead
of real time. If Lyria sends no source metadata, it reports the lead alone and says so.
