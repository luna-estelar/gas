# @luna-estelar/gas

GAS (Generative Audio Syntax) in one install: the language, the session runtime, the renderer and
the Lyria connector, with the `gas` command. It re-exports the individual `@luna-estelar/gas-*`
packages, pinned to one tested set of versions.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas)](https://www.npmjs.com/package/@luna-estelar/gas)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://github.com/luna-estelar/gas/actions/workflows/ci.yml/badge.svg)](https://github.com/luna-estelar/gas/actions/workflows/ci.yml)

## Install

```bash
npm install @luna-estelar/gas
```

## Example

A Node host that plays a GAS document through Lyria. The root is the application layer; the
renderer and the connector come from their own subpaths.

```ts
import { createSession, sourceText } from '@luna-estelar/gas';
import { createLyriaConnector } from '@luna-estelar/gas/lyria';
import type { MonotonicClock } from '@luna-estelar/gas/protocol';
import { createRenderer } from '@luna-estelar/gas/renderer';

declare const clock: MonotonicClock;
declare const apiKey: string;

const session = await createSession({
  createRenderer: () =>
    createRenderer({ clock, connector: createLyriaConnector(), settings: { apiKey } })
});
await session.loadSource(sourceText('tempo 96\nlength bars 8\n'));
await session.play();
```

In a browser, `@luna-estelar/gas/browser/session` composes the session, the renderer and a Web
Audio playback engine for you; see
[`@luna-estelar/gas-browser`](https://github.com/luna-estelar/gas/tree/main/packages/browser).

## Entry points

The root re-exports [`@luna-estelar/gas-api`](https://github.com/luna-estelar/gas/tree/main/packages/api): sessions, source helpers,
`GasOperationError`, and the protocol types a host handles. Every package is also available at a
subpath that mirrors it:

| Import                                                                       | Re-exports                              |
| ---------------------------------------------------------------------------- | --------------------------------------- |
| `@luna-estelar/gas`                                                          | `@luna-estelar/gas-api`                 |
| `@luna-estelar/gas/api`                                                      | `@luna-estelar/gas-api`                 |
| `@luna-estelar/gas/protocol`                                                 | `@luna-estelar/gas-protocol`            |
| `@luna-estelar/gas/protocol/validation`                                      | `@luna-estelar/gas-protocol/validation` |
| `@luna-estelar/gas/language`                                                 | `@luna-estelar/gas-language`            |
| `@luna-estelar/gas/core`                                                     | `@luna-estelar/gas-core`                |
| `@luna-estelar/gas/renderer`                                                 | `@luna-estelar/gas-renderer`            |
| `@luna-estelar/gas/notation`                                                 | `@luna-estelar/gas-notation`            |
| `@luna-estelar/gas/highlight`                                                | `@luna-estelar/gas-highlight`           |
| `@luna-estelar/gas/lyria`                                                    | `@luna-estelar/gas-connector-lyria`     |
| `@luna-estelar/gas/browser/{session,audio,capture,compile,timeline,inspect}` | `@luna-estelar/gas-browser/*`           |

The root exports `packageName` and `version` for this package; each subpath exports the
underlying package's own.

### Why most of GAS is behind subpaths

Node evaluates every module an import reaches, so a root that re-exported everything would load
the parser, the renderer, the Google GenAI SDK and browser code into every program. The root stays
small, and each subpath loads only its own package. The Lyria connector is the only entry point
that loads `@google/genai`, and browser code is only reached through `browser/*`.

## One install or individual packages, not both

This package pins exact versions of the packages it re-exports. If an application also installs
one of them directly at a different version, it gets two copies of that package, and values from
one copy are not recognized by the other. Use either `@luna-estelar/gas` or the individual
`@luna-estelar/gas-*` packages. If you do need both, match the versions this package pins
(`npm view @luna-estelar/gas dependencies`).

## The `gas` command

```bash
npx @luna-estelar/gas compile song.gas --out song.timeline.json
```

This is the same command as [`@luna-estelar/gas-cli`](https://github.com/luna-estelar/gas/tree/main/packages/cli). Always run it through a scoped
name: `npx gas` on its own fetches an unrelated npm package called `gas`. Install one of the two
globally, not both; npm refuses to link a second `gas` over the first.

## Runtime support

- ESM only.
- Node.js 22 or newer.
- The root, `api`, `protocol`, `core`, `renderer`, `notation`, `highlight`, `language` and `lyria`
  run in Node and in browsers. `browser/*` targets browsers and imports without touching browser
  globals.
- TypeScript types ship with every entry point.

## Related packages

This package depends on every `@luna-estelar/gas-*` package and adds no code of its own beyond the
`gas` command shim. Nothing in the GAS workspace depends on it.

## License

MIT
