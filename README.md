# GAS

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas)](https://www.npmjs.com/package/@luna-estelar/gas)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/ci.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/ci.yml)

Every generative music system has its own controls and its own interface. GAS (Generative Audio
Syntax) is an open, model-independent language and runtime for directing generative audio models.
You write your musical ideas in a `.gas` file, in as much or as little detail as you like, and your
application plays them and changes them on the fly through one interface, not many.

```gas
tempo 88
key "C major"
time_signature 4/4
length bars 4

track piano "Soft felt piano"

section intro:
    length bars 4
    bar 1:
        piano.play

intro()
```

Your application can change a piece while it plays. Changes apply straight away, without
restarting the music, and stay in effect until you clear them:

```gas-live
piano.flavor "busier, left hand walking"
```

GAS decides what plays, when, and in what style. The model writes the notes, so two renders of the
same document sound different.

## Install

```bash
npm install @luna-estelar/gas
```

Compile a document to timeline JSON, no API key needed:

```bash
npx @luna-estelar/gas compile song.gas
```

Use the scoped name. `npx gas` fetches an unrelated package.

To hear it, you need a connector for a music model, such as the Lyria RealTime connector:

```bash
npm install @luna-estelar/gas-lyria-rt
```

```ts
import { createRenderer, createSession, sourceText } from '@luna-estelar/gas';
import { compileSource } from '@luna-estelar/gas/language';
import { createLyriaRtConnector } from '@luna-estelar/gas-lyria-rt';
```

| Package                                                       | What it is                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| [`@luna-estelar/gas`](./packages/gas/README.md)               | The language, sessions, renderer, browser playback and CLI |
| [`@luna-estelar/gas-lyria-rt`](./packages/lyria-rt/README.md) | The Lyria RealTime connector                               |

## How it works

```text
document → compiler → timeline → session → renderer → connector → model
```

The compiler turns a document into a model-independent timeline. The session is what your
application talks to: it loads the timeline, takes changes and controls playback. The renderer
schedules requests against a clock, and a connector translates them for one model. Each connector
lists what its model supports; see [Lyria RealTime](./packages/lyria-rt/README.md#what-lyria-realtime-supports).

## Status

GAS is pre-1.0, so a minor release may break things. Each package's changelog records it when one
does. The timeline format is Protocol 1.0, which is versioned separately from the packages.

[Website](https://gas.lunaestelar.com) · [Docs](https://gas.lunaestelar.com/docs/getting-started/introduction/) · [Examples](./examples/README.md) ·
[Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) ·
[MIT license](./LICENSE)
