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

[Documentation](https://gas.lunaestelar.com/docs) ·
[Getting started](https://gas.lunaestelar.com/docs/getting-started) ·
[Playground](https://gas.lunaestelar.com/demos/playground) ·
[Architecture](https://gas.lunaestelar.com/docs/building/architecture)

## Try it

Compile a document without model credentials:

```bash
npx @luna-estelar/gas-cli compile song.gas
```

The CLI prints timeline JSON. Use `--out timeline.json` to write a file. The
[playground](https://gas.lunaestelar.com/demos/playground) also compiles documents in your
browser. Audio generation requires model access; see the
[Lyria manual guide](./packages/connector-lyria/manual/README.md).

## Install

The release contains ten scoped npm packages. There is no umbrella package named
`@luna-estelar/gas`.

```bash
npm install @luna-estelar/gas-api
npm install @luna-estelar/gas-browser
npm install @luna-estelar/gas-language
npm install @luna-estelar/gas-cli
```

Install the packages your application needs:

| Package                             | Purpose                                                |
| ----------------------------------- | ------------------------------------------------------ |
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

Each package has its own README with exports and usage examples. Packages are ESM-only
and share one release version. Internal dependencies pin that exact version when packed;
only matching versions are supported together.

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
controls. The [architecture guide](https://gas.lunaestelar.com/docs/building/architecture)
describes the package boundaries.

## Status

`0.1.0` is the first public preview. Package APIs may change in a minor release before
1.0; breaking changes will be recorded in the changelog. The packages implement
**Protocol 1.0**, which is distinct from the npm release version.

Lyria is currently the only connector:

- `flavor`, `tempo` and `timbre` are supported.
- `key` and `level` are approximated.
- `time_signature`, `notes` and `motif` compile and remain in session state, but Lyria
  cannot render them. GAS reports capability warnings.

See [model support](https://gas.lunaestelar.com/docs/reference/model-support) for details.
The [Way Back Home demo](https://gas.lunaestelar.com/demos/game) visualizes game-driven GAS
commands; audible session mounting in that demo remains in progress. The game and website
are maintained separately from this library.

## Repository and development

| Path                                | Contents                                            |
| ----------------------------------- | --------------------------------------------------- |
| [`packages/`](./packages)           | The ten library packages                            |
| [`examples/`](./examples/README.md) | Seven GAS documents and their shared manifest       |
| [`test/`](./test/README.md)         | Integration and publication checks                  |
| [`scripts/`](./scripts)             | Formatting, schema, boundary and publication checks |

Development requires Node 22.13 or newer and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm test
```

| Command                 | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `pnpm build`            | Build all packages                                                  |
| `pnpm test`             | Check formatting, build, schemas, boundaries, publication and tests |
| `pnpm format`           | Format tracked and nonignored source files                          |
| `pnpm format:check`     | Check the same files without editing                                |
| `pnpm check:schemas`    | Validate Protocol 1.0 schema fixtures                               |
| `pnpm check:boundaries` | Enforce package dependency boundaries                               |
| `pnpm check:publish`    | Check packed manifests and declaration entrypoints                  |
| `pnpm check:security`   | Query npm production dependency advisories                          |
| `pnpm clean`            | Remove TypeScript build outputs                                     |

The automated gate does not make model calls. Manual transport and listening checks are
kept in the Lyria connector's manual guide.

## Contributing and license

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development and release conventions and
[SECURITY.md](./SECURITY.md) for private vulnerability reporting. Website documentation
is maintained in its own repository.

[MIT](./LICENSE)
