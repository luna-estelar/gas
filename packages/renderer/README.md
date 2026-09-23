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

The package root exports `createRenderer`, the musical-time helpers (`barToTime`, `timeToBar`,
`secondsPerBar`, `secondsPerBeat`, `resolveTiming`, `createTempoSegmentMap`, `reanchorTempo`),
the `DEFAULT_TEMPO` and `DEFAULT_TIME_SIGNATURE` constants, the buffer and lookahead constants,
`RendererError`, and the `applyS16leGain` / `BufferLedger` audio helpers.

```ts
import { createRenderer } from '@luna-estelar/gas-renderer';
import type { Connector, MonotonicClock } from '@luna-estelar/gas-protocol';

declare const clock: MonotonicClock;
declare const connector: Connector;

const renderer = await createRenderer({ clock, connector });
console.log(renderer.getCapabilities());
```

## Dependencies

Hosts supply a monotonic clock. Tests use a virtual clock to check scheduling.
Browser applications can use `@luna-estelar/gas-browser` to compose the runtime.

This package pulls ajv and ajv-formats to validate connector configuration edits. A connector's
schema is compiled on the first `updateConnectorConfig` call, so a session that never edits its
configuration generates no code — which keeps it usable under a Content Security Policy without
`'unsafe-eval'`. Pass `checkConnectorContract` to also check a connector's own defaults against
its own schema at startup; connector test suites turn it on.
