# @luna-estelar/gas-api

The application-facing GAS session: load source, issue programmatic and live commands, control
playback, and observe state, warnings, positions and audio. It is the session stage of
`document → language → timeline → session → renderer → connector → model`.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-api)](https://www.npmjs.com/package/@luna-estelar/gas-api)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas-api)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/release.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/release.yml)

## Install

```bash
npm install @luna-estelar/gas-api
```

Part of `@luna-estelar/gas`, which installs every package.

## Example

The session takes a factory for its renderer. Here the renderer drives a connector the host
supplies, against the host's clock.

```ts
import { createSession, GasOperationError, sourceText } from '@luna-estelar/gas-api';
import type { Connector, MonotonicClock } from '@luna-estelar/gas-protocol';
import { createRenderer } from '@luna-estelar/gas-renderer';

declare const clock: MonotonicClock;
declare const connector: Connector;

const session = await createSession({
  createRenderer: () => createRenderer({ clock, connector })
});

session.on('lifecycle', (event) => {
  if (event.playback === 'stopped') console.log(event.completed ? 'finished' : 'stopped');
});

try {
  await session.loadSource(sourceText('tempo 88\nlength bars 4\n'));
  await session.play();
} catch (error) {
  if (error instanceof GasOperationError) console.log(error.kind, error.reason, error.closeCode);
}
```

## Exports

| Export                                                                                    | Purpose                                                                 |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `createSession`, `GasSession`                                                             | Create and drive a session                                              |
| `sourceText`, `sourceBytes`, `sourceBlob`, `sourceFile`, `sourceUrl`, `sourcePath`        | Describe where GAS source comes from                                    |
| `GasOperationError`                                                                       | The one error every rejecting operation throws                          |
| `SessionWiring`, `RendererControl`                                                        | The renderer factory a host supplies, and the control the session keeps |
| `SessionState`, `TrackView`, `CommandResult`, `LiveCommandResult`, `LoadResult`, …        | Results and state the session hands back                                |
| `SessionEvent`, `SessionEventMap`, `LifecycleEvent`, `DiagnosticEvent`, `WarningEvent`, … | Event names and payloads                                                |
| `version`                                                                                 | This package's version                                                  |

## Completion and failures

A finite piece that reaches its declared end stops the session on the renderer's own terminal
event. The `lifecycle` event for it carries `completed: true`; a `stop()` from the host does not.
Either way the session is `stopped` afterwards and `play()` starts a new run.

Every rejecting operation throws `GasOperationError`, and renderer failures during playback also
arrive on the `error` event. It carries `kind`, and, for connector failures, a safe `code`, a
`reason`, `retryable` and, when the failure came from a closed connection, the raw `closeCode`. A
connector classifies the standard close codes; the application range 4000-4999 belongs to the
service behind the endpoint, so the host maps it.

## Runtime support

- ESM-only.
- Node.js 22 or newer when used in Node; runs in browsers.
- The source helpers accept browser `Blob` and `File` values when those globals exist.

## Related packages

Depends on `@luna-estelar/gas-protocol`, `gas-language` (to compile source) and `gas-core`. A host
supplies a renderer such as `@luna-estelar/gas-renderer`; `@luna-estelar/gas-browser` composes the
session, renderer and audio for browsers. The root of `@luna-estelar/gas` re-exports this package.

## License

MIT
