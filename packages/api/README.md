# @luna-estelar/gas-api

Load a GAS document, play it, and change it while it plays. Send live commands or programmatic
ones, and listen for state, warnings, the playhead position and audio.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-api)](https://www.npmjs.com/package/@luna-estelar/gas-api)

## Install

```bash
npm install @luna-estelar/gas-api
```

Also included in `@luna-estelar/gas`, where it is the root import.

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

| Export                                                                                    | Purpose                                                              |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `createSession`, `GasSession`                                                             | Create and drive a session                                           |
| `sourceText`, `sourceBytes`, `sourceBlob`, `sourceFile`, `sourceUrl`, `sourcePath`        | Describe where GAS source comes from                                 |
| `GasOperationError`                                                                       | The error every failed operation throws                              |
| `SessionWiring`, `RendererControl`                                                        | The renderer factory a host supplies, and what the session gets back |
| `SessionState`, `TrackView`, `CommandResult`, `LiveCommandResult`, `LoadResult`, …        | Results and state the session hands back                             |
| `SessionEvent`, `SessionEventMap`, `LifecycleEvent`, `DiagnosticEvent`, `WarningEvent`, … | Event names and payloads                                             |
| `version`                                                                                 | This package's version                                               |

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

To make sound, pair it with `@luna-estelar/gas-renderer` and a connector such as
`@luna-estelar/gas-connector-lyria`. In a browser, `@luna-estelar/gas-browser` sets all three up
for you.

## License

MIT
