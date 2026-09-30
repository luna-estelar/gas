# @luna-estelar/gas-renderer

Turns a loaded timeline into a played session. It schedules changes against a host-supplied
monotonic clock and drives one connector per session, which is the renderer stage of
`document → language → timeline → session → renderer → connector → model`.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-renderer)](https://www.npmjs.com/package/@luna-estelar/gas-renderer)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas-renderer)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/ci.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/ci.yml)

## Install

```bash
npm install @luna-estelar/gas-renderer
```

Part of `@luna-estelar/gas`, which installs every package.

## Example

```ts
import { createRenderer } from '@luna-estelar/gas-renderer';
import type { Connector, MonotonicClock } from '@luna-estelar/gas-protocol';

declare const clock: MonotonicClock;
declare const connector: Connector;

const renderer = await createRenderer({ clock, connector });
console.log(renderer.getCapabilities());
```

Hosts supply both the clock and the connector; the renderer does not choose environment-specific
implementations and does not parse GAS source. Most applications hand `createRenderer` to
`@luna-estelar/gas-api`'s `createSession` rather than calling the renderer directly.

## Exports

| Export                                                                             | Purpose                                                          |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `createRenderer`, `CreateRendererOptions`                                          | Create a renderer around a clock and a connector                 |
| `RendererError`, `RendererErrorCode`, `RendererProblem`                            | Renderer errors, with connector configuration problems unchanged |
| `applyS16leGain`, `BufferLedger`, `AudioAccounting`                                | Audio gain and buffered-audio accounting                         |
| `BUFFER_WARNING_SECONDS`, `BUFFER_HARD_LIMIT_SECONDS`, `LOOKAHEAD_CHUNKS`, …       | Buffer, lookahead and first-audio timeout limits                 |
| `positionToTime`, `timeToPosition`, `comparePositions`, `createTempoSegmentMap`, … | Musical-time helpers, re-exported from `@luna-estelar/gas-core`  |
| `packageName`, `version`                                                           | This package's name and version                                  |

The musical-time conversions are owned by `@luna-estelar/gas-core` and re-exported here, so a host
that only needs to place a position in time can take them from Core without the Renderer.

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
given rather than treating that as "no position". After a finite piece completes, it keeps
answering for that run, capped at the declared end, until the next `start()` or a `stop()`, so a
playhead can follow the buffered tail.

Every failure the renderer emits carries the connector's `closeCode` when there was one.

## Configuration

This package compiles nothing at runtime, which is what keeps it usable under a Content Security
Policy without `'unsafe-eval'`. Configuration edits are checked by the connector, through the
optional `Connector.validateConfig`, and its problems are reported unchanged. A connector that
does not implement it gets its configuration through unchecked, with one
`connector-config-unvalidated` warning the first time a host edits it. (The two startup paths
cannot warn, because no listener exists until `createRenderer` resolves.) Pass
`checkConnectorContract` to also check a connector's own defaults through its own validator at
startup; connector test suites turn it on.

## Runtime support

- ESM-only.
- Node.js 20 or newer; runs in browsers.
- Tests use a virtual clock to check scheduling; any `MonotonicClock` works.

## Related packages

Depends on `@luna-estelar/gas-protocol`, `gas-core` and `gas-notation`. Works with any connector,
such as `@luna-estelar/gas-connector-lyria`. `@luna-estelar/gas-browser` composes it with a session
and Web Audio playback.

## License

MIT
