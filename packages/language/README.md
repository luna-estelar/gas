# GAS Language

`@luna-estelar/gas-language` parses, validates, and compiles GAS documents and live fragments
into model-independent timelines in musical time.

## Install

```bash
npm install @luna-estelar/gas-language
```

The package is ESM-only and requires Node.js 22 or newer when used in Node. It also runs in modern
browsers, with the bundle-cost consideration below.

The package root exports `compileSource`, `parseGasDocument`, `analyzeGasDocument`,
`parseLiveCommands`, `highlightSource`, and `slugify`, plus the `GasDocument` AST types,
`GasDiagnostic`, and the compile/parse result unions. No Langium types, CST nodes, or service
objects leak through that surface.

## Compile source

```ts
import { compileSource } from '@luna-estelar/gas-language';

const result = compileSource('tempo 88\nlength bars 4\n');
if (result.ok) console.log(result.timeline.compilerVersion);
```

## Dependencies

Importing the package root loads Langium and Chevrotain along with the parser.

Browser applications can defer compilation with a dynamic import of
`@luna-estelar/gas-browser/compile`. For token presentation alone,
`@luna-estelar/gas-highlight` uses language types without loading the parser at runtime.

Timelines carry a `compilerVersion` field recording this package's version, and a
`formatVersion` of `{ major: 1, minor: 0 }` recording the Protocol contract they satisfy. The two
move independently.
