# GAS

GAS (Generative Audio Syntax) is a language and runtime for directing generative audio
models. It compiles musical intent into a model-independent timeline, then schedules
changes through a connector while a session runs.

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

Live commands change a running session at musical boundaries:

```gas-live
piano.flavor "busier, left hand walking"
```

GAS controls arrangement, timing and intent. The model chooses the notes, phrasing and
sound; the same document does not guarantee the same performance on every render.

[Language](./packages/language/README.md) ·
[Sessions](./packages/api/README.md) ·
[Browser hosting](./packages/browser/README.md) ·
[Lyria connector](./packages/connector-lyria/README.md) ·
[Examples](./examples/README.md)

## Try it

Compile a document without model credentials:

```bash
npx @luna-estelar/gas compile song.gas
```

The CLI prints timeline JSON. Use `--out timeline.json` to write a file. Audio generation
requires model access; see the [Lyria manual guide](./packages/connector-lyria/manual/README.md).

## Install

```bash
npm install @luna-estelar/gas
```

`@luna-estelar/gas` installs the language, the session runtime, the renderer, the Lyria connector
and the `gas` command. Its root is the application API; every package is also available at a
subpath that mirrors it:

```ts
import { createSession, sourceText } from '@luna-estelar/gas';
import { compileSource } from '@luna-estelar/gas/language';
import { createLyriaConnector } from '@luna-estelar/gas/lyria';
import { createRenderer } from '@luna-estelar/gas/renderer';
```

Run the command as `npx @luna-estelar/gas`; a bare `npx gas` fetches an unrelated npm package.
See the [package README](./packages/gas/README.md) for every entry point.

### Installing individual packages

Each package is also published on its own. Use either the umbrella or individual packages, not
both: the umbrella pins exact versions, so a separately installed package at another version is a
second copy.

| Package                             | Purpose                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `@luna-estelar/gas`                 | Everything below, pinned to one tested set             |
| `@luna-estelar/gas-protocol`        | Shared contracts and JSON Schemas                      |
| `@luna-estelar/gas-language`        | Parsing, validation, compilation and live commands     |
| `@luna-estelar/gas-core`            | Session state, command validation and state derivation |
| `@luna-estelar/gas-api`             | Application-facing sessions and commands               |
| `@luna-estelar/gas-renderer`        | Scheduling, clocks and audio delivery                  |
| `@luna-estelar/gas-connector-lyria` | Lyria transport and prompt translation                 |
| `@luna-estelar/gas-browser`         | Browser playback, composition and timeline helpers     |
| `@luna-estelar/gas-cli`             | The `gas` command                                      |
| `@luna-estelar/gas-notation`        | Alda notation and MIDI encoding                        |
| `@luna-estelar/gas-highlight`       | Syntax classes and code-fence helpers                  |

Each package has its own README, with exports and usage examples, and a changelog. Packages are
ESM-only and versioned independently; internal dependencies use caret ranges, and the umbrella
pins exact versions.

For Node consumers, Protocol, Core, Notation, Renderer and the Lyria connector require
Node 20 or newer. Language, Highlight, API, CLI and Browser require Node 22 or newer
because their dependency tree includes Chevrotain. Browser runtime use is independent of
these Node requirements.

## Architecture

```text
document → language → timeline → session → renderer → connector → model
```

Language compilation is independent of playback. Core derives session state, the renderer
schedules changes against a supplied clock, and the connector translates them into model
controls. Each stage is its own package:
[language](./packages/language/README.md), [protocol](./packages/protocol/README.md) (the
timeline and every other shared contract), [core](./packages/core/README.md) and
[api](./packages/api/README.md) (the session), [renderer](./packages/renderer/README.md) and
[connector-lyria](./packages/connector-lyria/README.md). [browser](./packages/browser/README.md)
composes them for a web page. `scripts/check-boundaries.mjs` enforces which package may import
which.

## Status

0.2.0 is the launch release. Packages are versioned independently, so each has its own version
and changelog; APIs may change in a minor release before 1.0, and breaking changes are recorded in
the changelog of the package they affect. The packages implement **Protocol 1.0**, which is
distinct from any npm release version.

Lyria is currently the only connector:

- `flavor`, `tempo` and `timbre` are supported.
- `key` and `level` are approximated.
- `time_signature`, `notes` and `motif` compile and remain in session state, but Lyria
  cannot render them. GAS reports capability warnings.

See [what Lyria can and cannot do](./packages/connector-lyria/README.md#what-lyria-can-and-cannot-do)
for details. The GAS website and its demos are maintained separately from this library.

## Repository and development

| Path                                | Contents                                            |
| ----------------------------------- | --------------------------------------------------- |
| [`packages/`](./packages)           | The ten library packages and the umbrella           |
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
| `pnpm build`                    | Build all packages                                                                   |
| `pnpm test`                     | Check formatting, generated files, build, schemas, boundaries, publication and tests |
| `pnpm format`                   | Format tracked and nonignored source files                                           |
| `pnpm format:check`             | Check the same files without editing                                                 |
| `pnpm check:language-generated` | Check the committed parser and TextMate grammar match `gas.langium`                  |
| `pnpm check:schemas`            | Validate Protocol 1.0 schema fixtures                                                |
| `pnpm build:validators`         | Regenerate the precompiled timeline validator                                        |
| `pnpm check:validators`         | Check the committed validator matches the schemas                                    |
| `pnpm check:boundaries`         | Enforce package dependency boundaries                                                |
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
