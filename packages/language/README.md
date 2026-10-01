# @luna-estelar/gas-language

Parses, validates and compiles GAS documents and live fragments into model-independent timelines
in musical time. It is the language stage of `document → language → timeline → session → renderer
→ connector → model`.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-language)](https://www.npmjs.com/package/@luna-estelar/gas-language)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas-language)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/release.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/release.yml)

## Install

```bash
npm install @luna-estelar/gas-language
```

Part of `@luna-estelar/gas`, which installs every package.

## Example

```ts
import { compileSource } from '@luna-estelar/gas-language';

const result = compileSource('tempo 88\nlength bars 4\n');
if (result.ok) console.log(result.timeline.compilerVersion);
else console.log(result.diagnostics);
```

## Exports

| Export                                                                        | Purpose                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| `compileSource`                                                               | Compile a document into a Protocol 1.0 timeline           |
| `parseGasDocument`                                                            | Check syntax only                                         |
| `analyzeGasDocument`                                                          | Parse and validate into a `GasDocument` without compiling |
| `parseLiveCommands`                                                           | Parse a live fragment into an ordered statement list      |
| `highlightSource`                                                             | Highlight tokens and symbol occurrences for editors       |
| `slugify`                                                                     | The track-id slug the compiler uses, for hosts            |
| `GasDocument`, `Track`, `Section`, … and `LiveStatement`                      | The document and live-statement AST                       |
| `GasCompileResult`, `GasAnalyzeResult`, `GasParseResult`, `LiveCommandResult` | Result unions                                             |
| `GasDiagnostic`, `Timeline`, `MusicalPosition`, …                             | Protocol types, re-exported                               |
| `version`                                                                     | This package's version                                    |

No Langium types, CST nodes, or service objects leak through that surface.

Timelines carry a `compilerVersion` field recording this package's version, and a `formatVersion`
of `{ major: 1, minor: 0 }` recording the Protocol contract they satisfy. The two move
independently.

## Editor grammar

The tarball ships `syntaxes/gas.tmLanguage.json`, the TextMate grammar generated from
`src/gas.langium`. Editors and static highlighters can point at it directly; it is not reachable
through `exports`, so resolve it as a file within the package.

## Runtime support

- ESM-only.
- Node.js 22 or newer (Chevrotain's floor); runs in browsers.
- Importing the root loads Langium and Chevrotain along with the parser. Browser applications can
  defer that with a dynamic import of `@luna-estelar/gas-browser/compile`.

## Related packages

Depends on `@luna-estelar/gas-protocol`, `langium` and `chevrotain`. Used by `gas-api`, `gas-cli`
and `gas-browser`. For token presentation alone, `@luna-estelar/gas-highlight` has no dependencies:
it declares a structurally identical token type, so `highlightSource` output passes straight into
it.

## License

MIT
