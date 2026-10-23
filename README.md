# GAS

Music models like Lyria RealTime take a text prompt and stream audio back. You can't tell them
"piano for four bars, then bring in the strings". GAS (Generative Audio Syntax) adds that part: a
small language for tempo, sections and tracks, and a runtime that makes each change happen on the
right bar while the model plays.

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

Live commands change a piece while it plays, and take effect at the next bar:

```gas-live
piano.flavor "busier, left hand walking"
```

GAS controls arrangement, timing and intent. The model chooses the notes, phrasing and
sound; the same document does not guarantee the same performance on every render.

[Package guide](./packages/gas/README.md) ·
[Lyria connector](./packages/lyria/README.md) ·
[Examples](./examples/README.md)

## Try it

Compile a document without model credentials:

```bash
npx @luna-estelar/gas compile song.gas
```

The CLI prints timeline JSON. Use `--out timeline.json` to write a file. Audio generation
requires model access; see the [Lyria manual guide](./packages/lyria/manual/README.md).

## Install

```bash
npm install @luna-estelar/gas @luna-estelar/gas-lyria
```

`@luna-estelar/gas` installs the language, the session runtime, the renderer, browser playback and
the `gas` command. `@luna-estelar/gas-lyria` is the Lyria connector, a separate install so the
Google GenAI SDK is never part of GAS itself:

```ts
import { createRenderer, createSession, sourceText } from '@luna-estelar/gas';
import { compileSource } from '@luna-estelar/gas/language';
import { createLyriaConnector } from '@luna-estelar/gas-lyria';
```

Run the command as `npx @luna-estelar/gas`; a bare `npx gas` fetches an unrelated npm package.
See the [package README](./packages/gas/README.md) for every entry point.

### Packages

| Package                   | Purpose                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `@luna-estelar/gas`       | The language, sessions, renderer, browser playback and the `gas` command |
| `@luna-estelar/gas-lyria` | Plays GAS through Google's Lyria RealTime; a peer of `@luna-estelar/gas` |

Each has its own README and changelog. Both are ESM-only and need Node 22 or newer; in browsers
that does not apply.

## Architecture

```text
document → language → timeline → session → renderer → connector → model
```

Language compilation is independent of playback. Core derives session state, the renderer
schedules changes against a supplied clock, and the connector translates them into model
controls. Each stage is a module under [`packages/gas/src`](./packages/gas/src): `language`,
`protocol` (the timeline and every other shared contract), `core` and `api` (the session) and
`renderer`; `browser` composes them for a web page, and the connector lives in
[`packages/lyria`](./packages/lyria). `scripts/check-boundaries.mjs` enforces which module may
import which.

## Status

GAS ships as two packages, `@luna-estelar/gas` and `@luna-estelar/gas-lyria`, each with its own
version and changelog. APIs may change in a minor release before 1.0, and breaking changes are
recorded in the changelog of the package they affect. Both implement **Protocol 1.0**, which is
distinct from any npm release version.

Lyria is currently the only connector:

- `flavor`, `tempo` and `timbre` are supported.
- `key` and `level` are approximated.
- `time_signature`, `notes` and `motif` compile and remain in session state, but Lyria
  cannot render them. GAS reports capability warnings.

See [what Lyria can and cannot do](./packages/lyria/README.md#what-lyria-can-and-cannot-do)
for details. The GAS website and its demos are maintained separately from this library.

## Repository and development

| Path                                | Contents                                            |
| ----------------------------------- | --------------------------------------------------- |
| [`packages/`](./packages)           | The gas package and the Lyria connector             |
| [`examples/`](./examples/README.md) | Seven GAS documents and their shared manifest       |
| [`test/`](./test/README.md)         | Integration and publication checks                  |
| [`scripts/`](./scripts)             | Formatting, schema, boundary and publication checks |

Development requires Node 22.13 or newer and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm test
```

| Command                         | Purpose                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm build`                    | Build both packages                                                                  |
| `pnpm test`                     | Check formatting, generated files, build, schemas, boundaries, publication and tests |
| `pnpm format`                   | Format tracked and nonignored source files                                           |
| `pnpm format:check`             | Check the same files without editing                                                 |
| `pnpm check:language-generated` | Check the committed parser and TextMate grammar match `gas.langium`                  |
| `pnpm check:schemas`            | Validate Protocol 1.0 schema fixtures                                                |
| `pnpm build:validators`         | Regenerate the precompiled timeline validator                                        |
| `pnpm check:validators`         | Check the committed validator matches the schemas                                    |
| `pnpm check:no-dom`             | Typecheck every module but the browser host without DOM types                        |
| `pnpm check:boundaries`         | Enforce module dependency boundaries                                                 |
| `pnpm check:publish`            | Check packed manifests and declaration entrypoints                                   |
| `pnpm check:security`           | Query npm production dependency advisories                                           |
| `pnpm changeset`                | Record a release note and version bump for changed packages                          |
| `pnpm version-packages`         | Apply pending changesets (run by the release workflow)                               |
| `pnpm clean`                    | Remove TypeScript build outputs                                                      |

The automated gate does not make model calls. Manual transport and listening checks are
kept in the Lyria connector's manual guide.

## Contributing and license

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development and release conventions and
[SECURITY.md](./SECURITY.md) for private vulnerability reporting. Website documentation
is maintained in its own repository.

[MIT](./LICENSE)
