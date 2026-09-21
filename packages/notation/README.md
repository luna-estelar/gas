# GAS Notation

`@luna-estelar/gas-notation` holds the pure notation helpers GAS uses for the `notes` and `motif`
intents: parsing the minimal Alda subset GAS accepts, and encoding note events as a standard MIDI
file.

## Install

```bash
npm install @luna-estelar/gas-notation
```

The package is ESM-only, requires Node.js 20 or newer when used in Node, and has no browser-only or
Node-only runtime dependency.

The package root exports `parseAlda`, `toMidi`, `AldaParseError`, and the `NoteEvent` type.

## Parse and encode

```ts
import { parseAlda, toMidi } from '@luna-estelar/gas-notation';

const notes = parseAlda('o4 c e g');
const midi = toMidi(notes);
```

## Dependencies

Notation values arrive as strings from a compiled timeline. This package runs in browsers
and Node without I/O or a dependency on the GAS parser.

Lyria reports `notes` and `motif` as unsupported. These intents remain in session state
and produce capability warnings.
