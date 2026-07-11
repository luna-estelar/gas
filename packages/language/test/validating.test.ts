import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import { analyzeGasDocument, type GasDiagnostic } from '../src/index.js';
import { createGasServices } from '../src/gas-module.js';
import { isModel, type Model } from '../src/generated/ast.js';

let services: ReturnType<typeof createGasServices>;
let parse: ReturnType<typeof parseHelper<Model>>;

beforeAll(() => {
  services = createGasServices(EmptyFileSystem);
  const doParse = parseHelper<Model>(services.Gas);
  parse = (input: string) => doParse(input, { validation: true });
});

describe('GAS semantic validation', () => {
  test('accepts missing optional timing globals', () => {
    const result = analyzeGasDocument(`
length bars 4
track drums "Lofi breakbeat"

section intro:
    bar 1:
        drums.play

intro()
`);

    expect(result.ok).toBe(true);
    expect(codes(result.diagnostics)).not.toContain('missing-global');
    expect(codes(result.diagnostics)).not.toContain('missing-length');
  });

  test('requires global length', () => {
    const result = analyzeGasDocument(`
track drums "Lofi breakbeat"

section intro:
    bar 1:
        drums.play

intro()
`);

    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain('missing-length');
  });

  test('warns on duplicate globals and keeps first values', () => {
    const result = analyzeGasDocument(`
tempo 104
tempo 120
length bars 4
track drums "Lofi breakbeat"

section intro:
    length bars 4
    bar 1:
        drums.play

intro()
`);

    expect(codes(result.diagnostics)).toContain('duplicate-global');
    expect(result.document?.globals.tempo?.bpm).toBe(104);
  });

  test('validates tempo, time signature, length, and level ranges', () => {
    const result = analyzeGasDocument(`
tempo 0
time_signature 0/4
length bars 0
level 2
track drums "Lofi breakbeat"
drums.level 1.5

section intro:
    length bars 0
    bar 1:
        drums.play

intro()
`);

    expect(codes(result.diagnostics)).toContain('invalid-tempo');
    expect(codes(result.diagnostics)).toContain('invalid-time-signature');
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === 'invalid-length')
    ).toHaveLength(2);
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === 'invalid-level')
    ).toHaveLength(2);
  });

  test('rejects top-level play/stop but allows section-level shorthand before bars', () => {
    const topLevel = analyzeGasDocument(`
length bars 4
track drums "Lofi breakbeat"
drums.play

section intro:
    length bars 4
    bar 1:
        drums.stop

intro()
`);
    expect(codes(topLevel.diagnostics)).toContain('play-stop-not-timed');

    const shorthand = analyzeGasDocument(`
length bars 4
track drums "Lofi breakbeat"

section intro:
    length bars 4
    drums.play
    bar 4:
        drums.stop

intro()
`);
    expect(codes(shorthand.diagnostics)).not.toContain('play-stop-not-timed');
    expect(codes(shorthand.diagnostics)).not.toContain('play-stop-after-bar');
  });

  test('rejects section-level play/stop after a bar block', () => {
    const result = analyzeGasDocument(`
length bars 4
track drums "Lofi breakbeat"

section intro:
    length bars 4
    bar 1:
        drums.play
    drums.stop

intro()
`);

    expect(codes(result.diagnostics)).toContain('play-stop-after-bar');
  });

  test('validates bar order and known finite ranges', () => {
    const result = analyzeGasDocument(`
length bars 4
track drums "Lofi breakbeat"

section intro:
    length bars 4
    bar 4:
        drums.play
    bar 2:
        drums.stop
    bar 9:
        drums.play

intro()
`);

    expect(codes(result.diagnostics)).toContain('bar-not-monotonic');
    expect(codes(result.diagnostics)).toContain('bar-out-of-range');
  });

  test('warns on duplicate section flavor, empty arrangement, and length mismatch', () => {
    const sectionFlavor = analyzeGasDocument(`
length bars 4
track drums "Lofi breakbeat"

section intro:
    length bars 4
    flavor "soft"
    flavor "wide"
    bar 1:
        drums.play

intro()
`);
    expect(codes(sectionFlavor.diagnostics)).toContain('duplicate-section-flavor');

    const empty = analyzeGasDocument(`
length bars 4
track drums "Lofi breakbeat"
`);
    expect(codes(empty.diagnostics)).toContain('empty-arrangement');

    const mismatch = analyzeGasDocument(`
length bars 8
track drums "Lofi breakbeat"

section intro:
    length bars 4
    bar 1:
        drums.play

intro()
`);
    expect(codes(mismatch.diagnostics)).toContain('length-mismatch');
  });

  test('warns on region-order drift', () => {
    const result = analyzeGasDocument(`
length bars 4
track drums "Lofi breakbeat"

section intro:
    length bars 4
    bar 1:
        drums.play

intro()
drums.flavor "late"
`);

    expect(codes(result.diagnostics)).toContain('region-order');
  });

  test('notes and motif compile cleanly with no model-specific diagnostics', () => {
    const result = analyzeGasDocument(`
length bars 4
track keys "Juno keys"
keys.notes alda(o4 c d e)
keys.motif alda(o3 g a b)

section intro:
    length bars 4
    bar 1:
        keys.play

intro()
`);

    expect(result.ok).toBe(true);
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.category === 'informational')
    ).toEqual([]);
    expect(
      result.diagnostics.filter((diagnostic) =>
        `${diagnostic.code} ${diagnostic.message}`.toLowerCase().includes('lyria')
      )
    ).toEqual([]);
  });

  test('emits deferred diagnostics for each reserved keyword', () => {
    const fixtures = [
      ['lyrics', 'vox.lyrics "line"', 'reserved-lyrics'],
      ['lyrics.theme', 'vox.lyrics.theme "mountain solitude"', 'reserved-lyrics-theme'],
      ['effect', 'vox.effect "reverb"', 'reserved-effect'],
      ['extend', 'vox.extend "renderer knobs"', 'reserved-extend'],
      ['prompt', 'vox.prompt "raw prompt"', 'reserved-prompt']
    ] as const;

    for (const [, statement, expectedCode] of fixtures) {
      const result = analyzeGasDocument(`
length bars 4
track vox "Female airy solo voice"
${statement}

section intro:
    length bars 4
    bar 1:
        vox.play

intro()
`);

      const diagnostic = result.diagnostics.find((item) => item.code === expectedCode);
      expect(diagnostic).toEqual(
        expect.objectContaining({
          category: 'deferred',
          severity: 'error'
        })
      );
    }
  });

  test('surfaces semantic diagnostics through the Langium validation hook', async () => {
    const document = await parse(`
length bars 4
track drums "First"
track drums "Duplicate"
drums.prompt "raw"

section intro:
    length bars 4
    bar 1:
        drums.play

intro()
`);

    expect(checkDocumentValid(document)).toBeUndefined();
    expect(gasDiagnostic(document, 'duplicate-track')).toBeDefined();
    expect(gasDiagnostic(document, 'reserved-prompt')).toBeDefined();
  });
});

function codes(diagnostics: readonly GasDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function gasDiagnostic(
  document: LangiumDocument,
  code: string
): NonNullable<LangiumDocument['diagnostics']>[number] | undefined {
  return document.diagnostics?.find((diagnostic) => diagnostic.code === code);
}

function checkDocumentValid(document: LangiumDocument): string | undefined {
  return document.parseResult.parserErrors.length > 0
    ? `Parser errors:\n${document.parseResult.parserErrors.map((error) => error.message).join('\n')}`
    : document.parseResult.value === undefined
      ? `ParseResult is 'undefined'.`
      : !isModel(document.parseResult.value)
        ? `Root AST object is a ${document.parseResult.value.$type}, expected a 'Model'.`
        : undefined;
}
