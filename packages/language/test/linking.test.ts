import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { clearDocuments, parseHelper } from 'langium/test';
import { createGasServices } from '../src/gas-module.js';
import { isModel, type Model } from '../src/generated/ast.js';

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

describe('GAS linking', () => {
  test('links arrangement calls to sections', async () => {
    document = await parse(`
section chorus:
    length bars 8

chorus()
`);

    expect(checkDocumentValid(document)).toBeUndefined();
    const call = document.parseResult.value.elements.find(
      (element) => element.$type === 'SectionCall'
    );
    expect(call?.section.ref?.name).toBe('chorus');
  });

  test('links track statements to tracks', async () => {
    document = await parse(`
track drums "Lofi breakbeat"
drums.flavor "muffled"
`);

    expect(checkDocumentValid(document)).toBeUndefined();
    const statement = document.parseResult.value.elements.find(
      (element) => element.$type === 'TrackStatement'
    );
    expect(statement?.track.ref?.name).toBe('drums');
  });

  test('links keyword-like identifiers', async () => {
    document = await parse(`
track prompt "bright square lead"
prompt.play

section section:
    bar 1:
        prompt.level 0.6

section()
`);

    expect(checkDocumentValid(document)).toBeUndefined();
    const statement = document.parseResult.value.elements.find(
      (element) => element.$type === 'TrackStatement'
    );
    const call = document.parseResult.value.elements.find(
      (element) => element.$type === 'SectionCall'
    );
    expect(statement?.track.ref?.name).toBe('prompt');
    expect(call?.section.ref?.name).toBe('section');
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
