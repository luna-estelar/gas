# @luna-estelar/gas

Music models like Lyria RealTime take a text prompt and stream audio back. You can't tell them
"piano for four bars, then bring in the strings". GAS adds that part: a small language for tempo,
sections and tracks, and a runtime that makes each change happen on the right bar while the
model plays.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas)](https://www.npmjs.com/package/@luna-estelar/gas)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/release.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/release.yml)

```gas
tempo 100
key "A minor"
length bars 16

track piano "Solo grand piano, dry and close"
track strings "Lush orchestral strings, warm vibrato"

section intro:
    length bars 8
    bar 1:
        piano.play
    bar 5:
        strings.play

section peak:
    length bars 8
    flavor "full, urgent"

intro()
peak()
```

You can change a piece while it plays. Live commands take effect at the next bar:

```gas-live
strings.flavor "intense, full bow pressure"
```

GAS decides the structure: what plays, when, and in what style. The model writes the notes, so
two renders of the same document sound different.

[Website and live demos](https://gas.lunaestelar.com) ·
[Example documents](https://github.com/luna-estelar/gas/tree/main/examples/documents) ·
[Source](https://github.com/luna-estelar/gas)

## Install

```bash
npm install @luna-estelar/gas
```

Check a document without an API key. This prints the compiled timeline as JSON:

```bash
npx @luna-estelar/gas compile song.gas
```

## Example

Play a document in Node through Lyria RealTime. You need a Gemini API key, and you supply the
clock the session schedules against.

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

await session.loadSource(
  sourceText(`tempo 88
length bars 8
track piano "Soft felt piano"
section a:
    length bars 8
    bar 1:
        piano.play
a()
`)
);
await session.play();
await session.submitLiveCommands(sourceText('piano.flavor "busier, left hand walking"'));
```

In a browser, `@luna-estelar/gas/browser/session` sets up the session, the renderer and Web Audio
playback for you. See
[`@luna-estelar/gas-browser`](https://github.com/luna-estelar/gas/tree/main/packages/browser).

## Exports

The root is the session API from [`@luna-estelar/gas-api`](https://github.com/luna-estelar/gas/tree/main/packages/api); everything else is a subpath:

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

The root exports `version` for this package; each subpath exports the
underlying package's own.

Each subpath loads only what it needs. Only `/lyria` pulls in `@google/genai`, and only
`browser/*` contains browser code.

## One install or individual packages, not both

Installing this package and an individual `@luna-estelar/gas-*` package at a different version gives
you two copies that don't recognize each other's values. Pick one, or match the versions shown by
`npm view @luna-estelar/gas dependencies`.

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
  run in Node and in browsers. `browser/*` targets browsers.
- TypeScript types ship with every entry point.

## Related packages

Bundles every `@luna-estelar/gas-*` package listed above and adds the `gas` command.

## License

MIT
