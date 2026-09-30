# @luna-estelar/gas-core

The pure semantics of a GAS session: the input state a host accumulates, the commands that change
it, the state in effect at any musical position, and the one conversion between musical positions
and seconds. It sits between the timeline and the session in `document → language → timeline →
session → renderer → connector → model`.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-core)](https://www.npmjs.com/package/@luna-estelar/gas-core)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas-core)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/ci.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/ci.yml)

## Install

```bash
npm install @luna-estelar/gas-core
```

Part of `@luna-estelar/gas`, which installs every package.

## Example

```ts
import { createInputState, effectiveStateAt } from '@luna-estelar/gas-core';
import type { Timeline } from '@luna-estelar/gas-protocol';

declare const timeline: Timeline;

const input = createInputState(timeline);
const state = effectiveStateAt(input, { bar: 1 });
console.log(state.tracks);
```

## Exports

| Export                                                                       | Purpose                                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `createInputState`                                                           | Start a session's input state from a timeline                        |
| `applyCommand`, `defineTrack`                                                | Apply a canonical command, or declare a host track, with warnings    |
| `validateTimeline`                                                           | Structural and cross-record timeline validation                      |
| `warningsForTimeline`                                                        | Capability warnings for the intents a timeline uses                  |
| `effectiveStateAt`, `sectionInstanceAt`                                      | The state in effect, and the section instance, at a musical position |
| `authoredEventSchedule`                                                      | The authored events in playback order                                |
| `applyStop`, `applyCompletion`, `applyLoopBoundary`, `applyRetry`            | Session transitions for stop, completion, loop boundaries and retry  |
| `comparePositions`, `positionsEqual`                                         | Order and compare musical positions, fractions included              |
| `positionToTime`, `timeToPosition`                                           | Convert between a position and clock seconds through a tempo map     |
| `barToTime`, `timeToBarFraction`                                             | Bar-only conversions; the fraction is continuous                     |
| `createTempoSegmentMap`, `reanchorTempo`, `resolveTiming`                    | Build and re-anchor the tempo map                                    |
| `secondsPerBar`, `secondsPerBeat`                                            | Durations at a tempo and meter                                       |
| `DEFAULT_TEMPO`, `DEFAULT_TIME_SIGNATURE`, `TICKS_PER_BEAT`                  | Defaults, and the resolution of derived beat offsets (960)           |
| `Command`, `InputState`, `EffectiveState`, `TempoSegment`, `TimelineProblem` | The type families above                                              |
| `packageName`, `version`                                                     | This package's name and version                                      |

## Musical time

Tempo is beats per minute where a beat is the meter's `beatUnit` note, so `secondsPerBeat` is
`60 / tempo` in every meter. `timeToPosition` always returns a legal position — a whole bar, and an
offset in whole ticks over `TICKS_PER_BEAT` — while `timeToBarFraction` gives the continuous bar
coordinate that callers doing bar arithmetic need, above all to re-anchor a tempo change at the
exact current instant. These live here rather than in the Renderer so a browser host can place the
audible playhead without depending on the Renderer.

Core uses deterministic functions over plain values, with no clock or I/O. The API and the
Renderer share these functions for session semantics.

## Runtime support

- ESM-only.
- Node.js 20 or newer; runs in browsers.
- `"sideEffects": false`. `validateTimeline` imports `@luna-estelar/gas-protocol/validation`,
  whose validator is precompiled rather than built at runtime, so bundlers can drop it when it is
  unused. Check the consuming application's output to confirm tree shaking.

## Related packages

Depends on `@luna-estelar/gas-protocol`. Used by `gas-api`, `gas-renderer` and `gas-browser`.

## License

MIT
