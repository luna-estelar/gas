# Manual listening and timing checks

These runs need a live bridge and are outside the automated test gate. The
automated tests drive the connector against a scripted socket; the bridge's own
repository tests its protocol against a fake engine. Neither says anything about
how the real model sounds or how fast it answers, which is what this guide is for.

## Run

Start a bridge (see the mrt2-bridge README), then:

```sh
pnpm build
pnpm --filter @luna-estelar/gas-magenta-rt2 manual:listen \
  --fixture manual/fixtures/01-two-tracks.gas \
  --endpoint ws://127.0.0.1:8765 \
  --duration 20 --change-at 10 \
  --change 'lead.flavor "bright and airy"' \
  --out /absolute/path/to/ignored-listening
```

For a bridge started with `MRT2_BRIDGE_TOKEN`, set `GAS_MAGENTA_RT2_TOKEN` to the same value. The
script never takes the token as an argument.

The script plays the fixture through the real session and connector, applies one
live command part-way, and writes `capture.wav` and `manifest.json`:

| Field                     | Meaning                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `playResolvedSeconds`     | `play()` to resolved: connect, hello, prompt encoding, start |
| `firstAudioSeconds`       | `play()` to the first chunk the renderer delivers            |
| `audioSeconds`/`chunks`   | Audio delivered over the run                                 |
| `liveChange.applySeconds` | Live command to acknowledged by the bridge (not audible)     |
| `events`                  | Warnings, errors and status changes with timestamps          |

An acknowledgement means the engine accepted the change. When it becomes audible
depends on the bridge's lead (1 s by default), the engine's ring buffer (about
170 ms) and the host's own buffering. Judge that by ear from `capture.wav`.

`fixtures/02-long-opening-rest.gas` opens with 45 s of silence, longer than the
bridge's 30 s idle timeout. Run it with `--duration 60 --change-at 50`. It should
play from bar 19 with no `magenta-rt2-idle-timeout` in `events`.

## Start-up delay

```sh
pnpm build
pnpm --filter @luna-estelar/gas-magenta-rt2 manual:startup
```

Each run opens one socket over `openMagentaRt2Session`, starts, then pauses for 2,
4 and 8 s and resumes with new prompts. It prints min, median, p90, p95 and max
for connect and resume to first audio. `GAS_MAGENTA_RT2_ENDPOINT` (default
`ws://127.0.0.1:8765`), `GAS_MAGENTA_RT2_TOKEN`, `GAS_MAGENTA_RT2_STARTUP_RUNS`
(default 10) and `GAS_MAGENTA_RT2_STARTUP_OUTPUT` (a file for the raw samples)
come from the environment. The connector's `startupDelaySeconds` and
`initialStartupDelaySeconds` come from the p95s.

## Record

Record each run here with the engine revision, model, hardware and the numbers
above, plus what you heard. A run against the fake engine is a plumbing check
only.

| Date       | Engine                 | Model | Hardware | play → resolved | first audio | live ack | Notes                                                       |
| ---------- | ---------------------- | ----- | -------- | --------------- | ----------- | -------- | ----------------------------------------------------------- |
| 2026-10-24 | fake (`--fake-engine`) | fake  | M2 Max   | 0.017 s         | 0.018 s     | 0.005 s  | Plumbing only: 39 packets, contiguous, 6.24 s in 6.1 s wall |

Still to measure with the real engine:

- Start time for `mrt2_small` and `mrt2_base` (prompt encoding dominates).
- How long a style change takes to be heard, for weight-only and for new text.
- Pause and resume during a rest: context should be frozen, not generated ahead.
- Whether the renderer's one-packet lookahead (160 ms) is enough in a browser,
  with explicit `prebufferSeconds` and `firstAudioTimeoutSeconds`, or whether an
  independent renderer lookahead option is needed.
