# @luna-estelar/gas

Music models like Lyria RealTime take a text prompt and stream audio back. You can't tell them
"piano for four bars, then bring in the strings". GAS adds that part: a small language for tempo,
sections and tracks, and a runtime that makes each change happen on the right bar while the
model plays.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas)](https://www.npmjs.com/package/@luna-estelar/gas)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/ci.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/ci.yml)

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

Play a document in Node through Lyria RealTime. The connector is a separate package, so install it
too:

```bash
npm install @luna-estelar/gas @luna-estelar/gas-lyria-rt
```

You need a Gemini API key, and you supply the clock the session schedules against.

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

In a browser, `createBrowserSession` from `@luna-estelar/gas/browser` sets up the session, the
renderer and Web Audio playback for you.

## Exports

| Import                                  | What it gives you                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `@luna-estelar/gas`                     | Sessions, sources, errors, `createRenderer` and `version`                         |
| `@luna-estelar/gas/language`            | The parser, compiler, live commands and editor helpers                            |
| `@luna-estelar/gas/browser`             | A browser session, Web Audio playback, capture, timeline views and inspection     |
| `@luna-estelar/gas/protocol`            | The shared types, `ConnectorError` and JSON Schema types, for writing a connector |
| `@luna-estelar/gas/protocol/validation` | Precompiled timeline validation                                                   |
| `@luna-estelar/gas/highlight`           | Syntax highlighting classes without the parser                                    |

The JSON Schemas themselves ship at `@luna-estelar/gas/protocol/schemas/1.0/*`.

Each subpath loads only what it needs. Only `/language` loads the parser, nothing here loads
`@google/genai`, and only `/browser` contains browser code.

## The `gas` command

```bash
npx @luna-estelar/gas compile song.gas --out song.timeline.json
```

Always run it through the scoped name: `npx gas` on its own fetches an unrelated npm package
called `gas`.

## Runtime support

- ESM only.
- Node.js 22 or newer.
- The root, `/language`, `/protocol`, `/protocol/validation` and `/highlight` run in Node and in
  browsers. `/browser` targets browsers.
- TypeScript types ship with every entry point.

## Related packages

[`@luna-estelar/gas-lyria-rt`](https://github.com/luna-estelar/gas/tree/main/packages/lyria-rt)
plays GAS through Google's Lyria RealTime. It peers on this package, so a host and its connector
share one copy.

## License

MIT
