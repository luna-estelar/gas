# GAS API

`@luna-estelar/gas-api` provides sessions for loading GAS source, issuing programmatic and live
commands, controlling playback, and observing state, warnings, positions, and audio.

## Install

```bash
npm install @luna-estelar/gas-api
```

The package is ESM-only and requires Node.js 22 or newer when used in Node. Its source helpers also
accept browser `Blob` and `File` values when those globals are available.

The package root exports `createSession` and the `GasSession` class, the `sourceText` /
`sourceBytes` / `sourceBlob` / `sourceFile` / `sourceUrl` / `sourcePath` input helpers,
`GasOperationError`, and the `SessionWiring`, `SessionState`, `TrackView`, `SessionEvent` and
`CommandResult` type families.

## Create a session

```ts
import { createSession, sourceText, type SessionWiring } from '@luna-estelar/gas-api';

declare const wiring: SessionWiring;

const session = await createSession(wiring);
await session.loadSource(sourceText('tempo 88\nlength bars 4\n'));
```

## Dependencies

Supply a renderer and connector through the protocol-based wiring factory passed to
`createSession`. Browser hosts can use `@luna-estelar/gas-browser` for this composition.
