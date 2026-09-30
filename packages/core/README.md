# GAS Core

`@luna-estelar/gas-core` is the pure semantics of a GAS session: the input state a host
accumulates, the canonical command set that mutates it, the cascade that derives effective state
at a musical position, and the transition rules for stop, completion, loop boundaries, and retry.

Core uses deterministic functions over plain values, with no clock or I/O. The API and
renderer share these functions for session semantics.

## Install

```bash
npm install @luna-estelar/gas-core
```

The package is ESM-only and requires Node.js 20 or newer when used in Node. Its public operations
are pure functions and are also suitable for browser bundles.

The package root exports `createInputState`, `applyCommand`, `defineTrack`, `validateTimeline`,
`warningsForTimeline`, `effectiveStateAt`, `sectionInstanceAt`, `authoredEventSchedule`, and the
`applyStop` / `applyCompletion` / `applyLoopBoundary` / `applyRetry` transitions, along with the
`Command`, `InputState` and `EffectiveState` type families.

It also owns musical time: `comparePositions` and `positionsEqual` order absolute positions, and
`positionToTime` / `timeToPosition` convert between a position and clock seconds through a tempo
map built with `createTempoSegmentMap`, `reanchorTempo` and `resolveTiming`. Tempo is beats per
minute where a beat is the meter's `beatUnit` note, so `secondsPerBeat` is `60 / tempo` in every
meter. `timeToPosition` always returns a legal position — a whole bar, and an offset in whole ticks
over `TICKS_PER_BEAT` — while `timeToBarFraction` gives the continuous bar coordinate that callers
doing bar arithmetic need, above all to re-anchor a tempo change at the exact current instant.
These live here rather than in the Renderer so a browser host can place the audible playhead
without depending on the Renderer.

```ts
import { createInputState, effectiveStateAt } from '@luna-estelar/gas-core';
import type { Timeline } from '@luna-estelar/gas-protocol';

declare const timeline: Timeline;

const input = createInputState(timeline);
const state = effectiveStateAt(input, { bar: 1 });
console.log(state.tracks);
```

## Dependencies

`validateTimeline` imports `@luna-estelar/gas-protocol/validation`, whose validator is precompiled
rather than built at runtime. The package declares `"sideEffects": false` so bundlers can remove
unused validation code.
Check the output of the consuming application to confirm tree shaking.
