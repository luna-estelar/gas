# GAS Renderer

`@luna-estelar/gas-renderer` turns a loaded timeline into a played session. It owns the
musical-to-clock conversion, the scheduler running against a host-supplied monotonic clock, the
current input state with effective-state derivation through `@luna-estelar/gas-core`, and one
active connector instance per session.

The renderer accepts a connector through the Protocol interface and does not parse GAS source.

## Install

```bash
npm install @luna-estelar/gas-renderer
```

The package is ESM-only and requires Node.js 20 or newer when used in Node. Hosts supply both the
clock and connector; the renderer does not choose environment-specific implementations.

The package root exports `createRenderer`, the buffer, lookahead and first-audio constants,
`RendererError`, the `applyS16leGain` / `BufferLedger` audio helpers, and the musical-time helpers
(`barToTime`, `timeToBarFraction`, `positionToTime`, `timeToPosition`, `comparePositions`,
`positionsEqual`, `secondsPerBar`, `secondsPerBeat`, `resolveTiming`, `createTempoSegmentMap`,
`reanchorTempo`) with the `DEFAULT_TEMPO`, `DEFAULT_TIME_SIGNATURE` and `TICKS_PER_BEAT` constants.
Those conversions are owned by `@luna-estelar/gas-core` and re-exported here, so a host that only
needs to place a position in time can take them from Core without pulling in the Renderer.

```ts
import { createRenderer } from '@luna-estelar/gas-renderer';
import type { Connector, MonotonicClock } from '@luna-estelar/gas-protocol';

declare const clock: MonotonicClock;
declare const connector: Connector;

const renderer = await createRenderer({ clock, connector });
console.log(renderer.getCapabilities());
```

## When musical time starts

By default the renderer anchors bar one to the arrival of the first audio chunk, so the musical
clock and the audible clock agree. For a connector whose `start()` resolves at session setup —
Lyria's does, well before any audio exists — anchoring there would start musical time early and
leave every later chunk that much closer to being late. `start()` still resolves as soon as the run
is allocated, with playback reported as `starting`; the run becomes `running` when the first chunk
arrives, and the first `position` event reads zero seconds however long startup took.

A host may still change state in that window: an update before the anchor applies at bar one, and a
tempo set there is the tempo the anchored run plays at.

- `anchor: 'connector-start'` restores the older behavior for a connector whose start already means
  audio is flowing.
- `firstAudioTimeoutSeconds` fails the run when a connector connects and then stays silent, timed
  from the moment anchoring becomes possible. It defaults to three chunk durations, clamped to
  2-15 seconds. Connector setup has its own timeout; this one covers "connected but quiet".

A finite piece that reaches its declared length emits a terminal status carrying both its `runId`
and `completed: true`, then the ordinary `stopped` status. That is what lets a host tell a piece
that finished from one it stopped.

`positionAtSeconds` maps seconds after the anchor to a musical position, for placing a playhead
against audio the host has actually played. It answers `undefined` for an instant the live tempo map
cannot place — a loop boundary rebuilds that map from bar one, so a host whose audio still lags the
rollover is asking about an iteration the map no longer describes. Hold the last position you were
given rather than treating that as "no position".

## Dependencies

Hosts supply a monotonic clock. Tests use a virtual clock to check scheduling.
Browser applications can use `@luna-estelar/gas-browser` to compose the runtime.

This package compiles nothing at runtime, which is what keeps it usable under a Content Security
Policy without `'unsafe-eval'`. Configuration edits are checked by the connector, through the
optional `Connector.validateConfig`; a connector that does not implement it gets its configuration
through unchecked, with one `connector-config-unvalidated` warning the first time a host edits it.
(The two startup paths cannot warn, because no listener exists until `createRenderer` resolves.)
Pass `checkConnectorContract` to also check a connector's own defaults through its own validator at
startup; connector test suites turn it on.
