# @luna-estelar/gas

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas)](https://www.npmjs.com/package/@luna-estelar/gas)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/ci.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/ci.yml)

Every generative music system has its own controls and its own interface. GAS (Generative Audio
Syntax) is an open, model-independent language and runtime for directing generative audio models.
You write your musical ideas in a `.gas` file, in as much or as little detail as you like, and your
application plays them and changes them on the fly through one interface, not many.

[Website](https://gas.lunaestelar.com) · [Docs](https://gas.lunaestelar.com/docs/getting-started/introduction/) ·
[Source](https://github.com/luna-estelar/gas)

## Install

```bash
npm install @luna-estelar/gas
```

Compile a document to timeline JSON, no API key needed:

```bash
npx @luna-estelar/gas compile song.gas --out song.timeline.json
```

Use the scoped name. `npx gas` fetches an unrelated package.

## Example

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

Your application can change a piece while it plays. Changes apply straight away, without
restarting the music, and stay in effect until you clear them:

```gas-live
strings.flavor "intense, full bow pressure"
```

GAS decides what plays, when, and in what style. The model writes the notes, so two renders of the
same document sound different.

To play a document in Node you need a connector, a clock and an API key. This uses the Lyria
RealTime connector,
[`@luna-estelar/gas-lyria-rt`](https://github.com/luna-estelar/gas/tree/main/packages/lyria-rt):

```ts
import { createRenderer, createSession, sourceText } from '@luna-estelar/gas';
import type { MonotonicClock } from '@luna-estelar/gas/protocol';
import { createLyriaRtConnector } from '@luna-estelar/gas-lyria-rt';

declare const clock: MonotonicClock;
declare const apiKey: string;

const session = await createSession({
  createRenderer: () =>
    createRenderer({ clock, connector: createLyriaRtConnector(), settings: { apiKey } })
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

In a browser, `createBrowserSession` from `@luna-estelar/gas/browser` also sets up the renderer
and Web Audio playback.

## Exports

| Import                                  | Contents                                                     |
| --------------------------------------- | ------------------------------------------------------------ |
| `@luna-estelar/gas`                     | Sessions, sources, errors, `createRenderer` and `version`    |
| `@luna-estelar/gas/language`            | Parser, compiler, live commands and editor helpers           |
| `@luna-estelar/gas/browser`             | Browser session, Web Audio playback, capture, timeline views |
| `@luna-estelar/gas/protocol`            | Shared types and `ConnectorError`, for writing a connector   |
| `@luna-estelar/gas/protocol/validation` | Precompiled timeline validation                              |
| `@luna-estelar/gas/highlight`           | Syntax highlighting classes, without the parser              |

The JSON Schemas are at `@luna-estelar/gas/protocol/schemas/1.0/*`. Only `/language` loads the
parser.

## Runtime support

ESM only, with TypeScript types. Node.js 22 or newer and browsers; `/browser` is browser-only.

## License

MIT
