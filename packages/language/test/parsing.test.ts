import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import { createGasServices } from '../src/gas-module.js';
import { isModel, type Model } from '../src/generated/ast.js';
import { parseGasDocument } from '../src/index.js';

let services: ReturnType<typeof createGasServices>;
let parse: ReturnType<typeof parseHelper<Model>>;

beforeAll(() => {
  services = createGasServices(EmptyFileSystem);
  parse = parseHelper<Model>(services.Gas);
});

describe('GAS parsing', () => {
  test('parses a section body', async () => {
    const document = await parse(`
section chorus:
    length bars 8
`);

    expect(checkDocumentValid(document)).toBeUndefined();
  });

  test('parses a nested bar block', async () => {
    const document = await parse(`
track drums "Lofi breakbeat"

section chorus:
    bar 1:
        drums.play
`);

    expect(checkDocumentValid(document)).toBeUndefined();
  });

  test('parses top-level defaults and arrangement calls', async () => {
    const document = await parse(`
track guitar "A bright, clean stratocaster"
guitar.flavor "muted"

section chorus:
    bar 1:
        guitar.play

chorus()
`);

    expect(checkDocumentValid(document)).toBeUndefined();
  });

  test('parses v1 globals and length forms', async () => {
    for (const length of ['length bars 16', 'length bars 16 loop', 'length infinite']) {
      const document = await parse(`
tempo 104
time_signature 4/4
key "D minor"
${length}
flavor "nocturnal synthwave"
level 0.8
`);

      expect(checkDocumentValid(document)).toBeUndefined();
    }
  });

  test('parses documents without optional timing globals', async () => {
    const document = await parse(`
length bars 8
track pad "soft pad"

section intro:
    bar 1:
        pad.play

intro()
`);

    expect(checkDocumentValid(document)).toBeUndefined();
  });

  test('parses global and track level', async () => {
    const document = await parse(`
length bars 8
level 0.7
track drums "dry kit"
drums.level 0.5
`);

    expect(checkDocumentValid(document)).toBeUndefined();
  });

  test('parses the v1 document surface', async () => {
    const document = await parse(`
# global config
tempo 104
key "C minor"
time_signature 4/4
length bars 16 loop
flavor "lofi, intimate, late night"
level 0.8

# tracks
track guitar "A bright, clean stratocaster playing muted chords"
track drums "Lofi breakbeat, muffled snare"
track vox "Female airy solo voice"
track keys "Juno keys, saw wave, detuned, expressive"

# track defaults
drums.timbre "dry drum machine"
keys.motif alda(
    o3
    g8 a b > c d e f+ g
)

# sections
section chorus:
    length bars 8
    flavor "wide opening"
    guitar.flavor "muted"
    guitar.notes alda(
        o4 c d e
    )

    bar 1:
        drums.play
        guitar.play
        vox.play

    bar 5:
        drums.flavor "buildup"

section verse:
    length bars 8
    guitar.flavor "sustained notes, open voicings"

    bar 1:
        guitar.play

# arrangement
chorus()
verse()
`);

    expect(checkDocumentValid(document)).toBeUndefined();
    expect(document.parseResult.value.elements).toHaveLength(16);
  });

  // Parsing accepts section play/stop statements; semantic validation checks their placement.
  test('accepts section-level play/stop before bar blocks', async () => {
    const document = await parse(`
track drums "Lofi breakbeat"
track pad "soft pad"

section chorus:
    drums.play
    bar 5:
        drums.stop

section drone:
    length bars 4
    pad.play
`);

    expect(checkDocumentValid(document)).toBeUndefined();
  });

  test('rejects old key_signature syntax', () => {
    const result = parseGasDocument('key_signature "C major"\nlength bars 4\n');

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });
});

function checkDocumentValid(document: LangiumDocument): string | undefined {
  return document.parseResult.parserErrors.length > 0
    ? `Parser errors:\n${document.parseResult.parserErrors.map((error) => error.message).join('\n')}`
    : document.parseResult.value === undefined
      ? `ParseResult is 'undefined'.`
      : !isModel(document.parseResult.value)
        ? `Root AST object is a ${document.parseResult.value.$type}, expected a 'Model'.`
        : undefined;
}
