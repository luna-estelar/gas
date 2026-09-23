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
