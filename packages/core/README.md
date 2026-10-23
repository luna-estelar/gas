# @luna-estelar/gas-core

Session state and musical time for GAS. Apply commands to a session, ask what is playing at any
bar, and convert between bars and seconds. Everything here is a plain function over plain values,
so it runs the same in Node, a browser or a test.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-core)](https://www.npmjs.com/package/@luna-estelar/gas-core)

## Install

```bash
npm install @luna-estelar/gas-core
```

Also included in `@luna-estelar/gas` as `@luna-estelar/gas/core`.

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

| Export                                                                       | Purpose                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `createInputState`                                                           | Start a session's input state from a timeline                       |
| `applyCommand`, `defineTrack`                                                | Apply a canonical command, or declare a host track, with warnings   |
| `validateTimeline`                                                           | Structural and cross-record timeline validation                     |
| `warningsForTimeline`                                                        | Capability warnings for the intents a timeline uses                 |
| `effectiveStateAt`, `sectionInstanceAt`                                      | What is playing, and which section instance, at a musical position  |
| `authoredEventSchedule`                                                      | The authored events in playback order                               |
| `applyStop`, `applyCompletion`, `applyLoopBoundary`, `applyRetry`            | Session transitions for stop, completion, loop boundaries and retry |
| `comparePositions`, `positionsEqual`                                         | Order and compare musical positions, fractions included             |
| `positionToTime`, `timeToPosition`                                           | Convert between a position and clock seconds through a tempo map    |
| `barToTime`, `timeToBarFraction`                                             | Bar-only conversions; the fraction is continuous                    |
| `createTempoSegmentMap`, `reanchorTempo`, `resolveTiming`                    | Build and re-anchor the tempo map                                   |
| `secondsPerBar`, `secondsPerBeat`                                            | Durations at a tempo and meter                                      |
| `DEFAULT_TEMPO`, `DEFAULT_TIME_SIGNATURE`, `TICKS_PER_BEAT`                  | Defaults, and the resolution of derived beat offsets (960)          |
| `Command`, `InputState`, `EffectiveState`, `TempoSegment`, `TimelineProblem` | The type families above                                             |
| `version`                                                                    | This package's version                                              |

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
- `"sideEffects": false`.

## Related packages

`@luna-estelar/gas-api` and `@luna-estelar/gas-renderer` use it for you. Install it directly when
you need session state or musical time on their own, for example to draw a playhead.

## License

MIT
