# @luna-estelar/gas-notation

Read the notes and motifs written in a GAS document. It parses the small Alda subset GAS accepts
for `notes` and `motif`, and writes the result as a standard MIDI file.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-notation)](https://www.npmjs.com/package/@luna-estelar/gas-notation)

## Install

```bash
npm install @luna-estelar/gas-notation
```

Also included in `@luna-estelar/gas` as `@luna-estelar/gas/notation`.

## Example

```ts
import { AldaParseError, parseAlda, toMidi } from '@luna-estelar/gas-notation';

try {
  const notes = parseAlda('o4 c8 d e f g2');
  const midi = toMidi(notes);
  console.log(notes.length, midi.byteLength);
} catch (error) {
  if (error instanceof AldaParseError) console.log(error.message);
}
```

## Exports

| Export           | Purpose                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `parseAlda`      | Parse the supported Alda subset into note events                    |
| `toMidi`         | Encode note events as a Standard MIDI File (`Uint8Array`)           |
| `AldaParseError` | Thrown for anything outside the subset, with the source offset      |
| `NoteEvent`      | `{ pitch, start, duration, velocity }`, with times in quarter notes |
| `version`        | This package's version                                              |

## Supported Alda subset

GAS accepts a deliberately small, single-voice subset of Alda:

- Notes `a` to `g`, with any number of sharps (`+`), flats (`-`) or a natural (`_`).
- Note lengths as note values (`c4`, `c8`, `c16`), with dots after an explicit length (`c4.`). A
  note without a length takes the previous note's length; the first defaults to a quarter note.
  A dot on a note without an explicit length is an error, because it is ambiguous.
- Octaves with `o<n>` (default `o4`), and `>` / `<` to step up or down.
- Line comments starting with `#`.

Everything else raises `AldaParseError`, including rests (`r`), chords (`/`), ties (`~`),
parenthetical attributes, repeats and alternate endings, markers, cram expressions (`{ }`),
variables, voices and absolute durations. A pitch outside the MIDI range 0-127 is also an error.

Lyria reports `notes` and `motif` as unsupported, so it does not render them. The values remain in
session state and produce capability warnings; a connector that renders notation can use this
package to read them.

## Runtime support

- ESM-only.
- Node.js 20 or newer; runs in browsers.
- No I/O, and no dependency on the GAS parser.

## Related packages

`@luna-estelar/gas-renderer` uses it to read notes and motifs. A connector that renders notation
can use it the same way.

## License

MIT
