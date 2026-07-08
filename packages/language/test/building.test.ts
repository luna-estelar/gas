import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { clearDocuments, parseHelper } from 'langium/test';
import { createGasServices } from '../src/gas-module.js';
import { isModel, type Model } from '../src/generated/ast.js';
import { buildDocument } from '../src/semantic/build.js';

let services: ReturnType<typeof createGasServices>;
let parse: ReturnType<typeof parseHelper<Model>>;
let document: LangiumDocument<Model> | undefined;

beforeAll(() => {
  services = createGasServices(EmptyFileSystem);
  parse = parseHelper<Model>(services.Gas);
});

afterEach(async () => {
  if (document) {
    await clearDocuments(services.shared, [document]);
    document = undefined;
  }
});

describe('GAS semantic AST building', () => {
  test('builds a v1 document with globals, tracks, sections, bars, and arrangement', async () => {
    document = await parse(`
tempo 104
key "C minor"
time_signature 4/4
length bars 16 loop
flavor "lofi, intimate, late night"
level 0.8

track guitar "A bright, clean stratocaster playing muted chords"
track drums "Lofi breakbeat, muffled snare"
track vox "Female airy solo voice"
track keys "Juno keys, saw wave, detuned, expressive"

drums.timbre "dry drum machine"
keys.motif alda(
    o3
    g8 a b > c d e f+ g
)

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

chorus()
verse()
`);

    expect(checkDocumentValid(document)).toBeUndefined();
    const { document: gasDocument, diagnostics } = buildDocument(document.parseResult.value);

    expect(diagnostics).toEqual([]);
    expect(gasDocument.globals.tempo?.bpm).toBe(104);
    expect(gasDocument.globals.key?.value).toBe('C minor');
    expect(gasDocument.globals.timeSignature).toEqual(
      expect.objectContaining({ numerator: 4, denominator: 4 })
    );
    expect(gasDocument.globals.length).toEqual(expect.objectContaining({ mode: 'loop', bars: 16 }));
    expect(gasDocument.globals.level?.value).toBe(0.8);
    expect([...gasDocument.tracksByName.keys()]).toEqual(['guitar', 'drums', 'vox', 'keys']);

    expect(gasDocument.tracksByName.get('drums')?.defaults).toEqual([
      expect.objectContaining({ kind: 'Timbre', trackName: 'drums' })
    ]);

    const chorus = gasDocument.sectionsByName.get('chorus');
    expect(chorus?.length?.bars).toBe(8);
    expect(chorus?.setup.map((command) => command.kind)).toEqual(['Flavor', 'Notes']);
    expect(chorus?.bars.map((bar) => bar.number)).toEqual([1, 5]);
    expect(chorus?.bars[0]?.commands.map((command) => command.kind)).toEqual([
      'Play',
      'Play',
      'Play'
    ]);

    const keysMotif = gasDocument.tracksByName.get('keys')?.defaults[0];
    expect(keysMotif).toEqual(expect.objectContaining({ kind: 'Motif', trackName: 'keys' }));
    if (keysMotif?.kind !== 'Motif') {
      throw new Error('Expected keys motif command.');
    }
    expect(keysMotif.value.raw).not.toContain('alda(');
    expect(keysMotif.value.raw).toContain('g8 a b > c d e f+ g');

    expect(gasDocument.arrangement.map((call) => call.sectionName)).toEqual(['chorus', 'verse']);
    expect(() => JSON.stringify(gasDocument)).not.toThrow();
  });

  test('represents each global length mode', async () => {
    for (const [source, expected] of [
      ['length bars 4', { mode: 'finite', bars: 4 }],
      ['length bars 4 loop', { mode: 'loop', bars: 4 }],
      ['length infinite', { mode: 'infinite' }]
    ] as const) {
      document = await parse(source);
      expect(checkDocumentValid(document)).toBeUndefined();

      const { document: gasDocument } = buildDocument(document.parseResult.value);
      expect(gasDocument.globals.length).toEqual(expect.objectContaining(expected));

      await clearDocuments(services.shared, [document]);
      document = undefined;
    }
  });

  test('attaches defaults, diagnoses duplicate tracks, and retains orphan commands', async () => {
    document = await parse(`
track guitar "First guitar"
track guitar "Duplicate guitar"
guitar.flavor "muted"
bass.play
`);

    expect(checkDocumentValid(document)).toBeUndefined();
    const { document: gasDocument, diagnostics } = buildDocument(document.parseResult.value);

    expect(gasDocument.tracks).toHaveLength(2);
    expect(gasDocument.tracksByName.get('guitar')?.description).toBe('First guitar');
    expect(gasDocument.tracksByName.get('guitar')?.defaults).toEqual([
      expect.objectContaining({ kind: 'Flavor', trackName: 'guitar', value: 'muted' })
    ]);
    expect(gasDocument.orphanCommands).toEqual([
      expect.objectContaining({ kind: 'Play', trackName: 'bass' })
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'duplicate-track',
      'unresolved-track'
    ]);
  });

  test('decodes escaped strings and preserves contextual keyword identifiers', async () => {
    document = await parse(`
track prompt "Line\\nTab\\tQuote\\"Slash\\\\Done"
prompt.timbre "bright"
`);

    expect(checkDocumentValid(document)).toBeUndefined();
    const { document: gasDocument, diagnostics } = buildDocument(document.parseResult.value);

    expect(diagnostics).toEqual([]);
    expect(gasDocument.tracksByName.get('prompt')?.description).toBe(
      'Line\nTab\tQuote"Slash\\Done'
    );
    expect(gasDocument.tracksByName.get('prompt')?.defaults).toEqual([
      expect.objectContaining({ kind: 'Timbre', trackName: 'prompt' })
    ]);
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
