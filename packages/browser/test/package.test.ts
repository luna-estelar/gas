import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(packageRoot, 'src');

function sourceFiles(directory = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

function subpathFor(file: string): string {
  return `./${path.relative(sourceRoot, file).replace(/\.ts$/, '').split(path.sep).join('/')}`;
}

function importHasValue(clause: ts.ImportClause | undefined): boolean {
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined) return true;
  if (clause.namedBindings === undefined || ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function exportHasValue(declaration: ts.ExportDeclaration): boolean {
  if (declaration.isTypeOnly) return false;
  if (declaration.exportClause === undefined || ts.isNamespaceExport(declaration.exportClause)) {
    return true;
  }
  return declaration.exportClause.elements.some((element) => !element.isTypeOnly);
}

interface LanguageReference {
  readonly kind: 'dynamic-import' | 'export' | 'import' | 'import-type';
  readonly value: boolean;
}

function isLanguageSpecifier(value: string): boolean {
  return value === '@luna-estelar/gas-language' || value.startsWith('@luna-estelar/gas-language/');
}

function languageReferences(source: ts.SourceFile): LanguageReference[] {
  const references: LanguageReference[] = [];
  const add = (kind: LanguageReference['kind'], value: boolean, specifier: string): void => {
    if (isLanguageSpecifier(specifier)) references.push({ kind, value });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add('import', importHasValue(node.importClause), node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add('export', exportHasValue(node), node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      add('dynamic-import', true, node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add('import-type', false, node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

describe('browser package surface', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
  ) as Record<string, unknown> & {
    exports: Record<string, { readonly types: string; readonly default: string }>;
  };

  it('has no root entry or legacy root fallback', () => {
    expect(manifest).not.toHaveProperty('main');
    expect(manifest).not.toHaveProperty('module');
    expect(manifest).not.toHaveProperty('types');
    expect('.' in manifest.exports).toBe(false);
  });

  it('exports every source module explicitly and no others', () => {
    const files = sourceFiles();
    const sourceSubpaths = files.map(subpathFor).sort();
    expect(Object.keys(manifest.exports).sort()).toEqual(sourceSubpaths);

    for (const file of files) {
      const subpath = subpathFor(file);
      const output = subpath.slice(2);
      expect(manifest.exports[subpath]).toEqual({
        types: `./out/${output}.d.ts`,
        default: `./out/${output}.js`
      });
    }
  });

  it('keeps gas-language as a value dependency of compile only', () => {
    const references = sourceFiles().flatMap((file) => {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );
      return languageReferences(source).map((reference) => ({
        ...reference,
        file: path.relative(sourceRoot, file).split(path.sep).join('/')
      }));
    });

    expect(references.filter(({ value }) => value).map(({ file }) => file)).toEqual(['compile.ts']);
    expect(
      references.filter(({ file }) => file !== 'compile.ts').every(({ value }) => !value)
    ).toBe(true);
  });

  it('classifies imports, re-exports, and dynamic imports by runtime cost', () => {
    const source = ts.createSourceFile(
      'references.ts',
      [
        "import type { HighlightToken } from '@luna-estelar/gas-language';",
        "export type { HighlightToken } from '@luna-estelar/gas-language';",
        "export { type HighlightToken } from '@luna-estelar/gas-language';",
        "type Token = import('@luna-estelar/gas-language').HighlightToken;",
        "import { compileSource } from '@luna-estelar/gas-language';",
        "export { compileSource } from '@luna-estelar/gas-language';",
        "export * from '@luna-estelar/gas-language';",
        "void import('@luna-estelar/gas-language');"
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    expect(languageReferences(source)).toEqual([
      { kind: 'import', value: false },
      { kind: 'export', value: false },
      { kind: 'export', value: false },
      { kind: 'import-type', value: false },
      { kind: 'import', value: true },
      { kind: 'export', value: true },
      { kind: 'export', value: true },
      { kind: 'dynamic-import', value: true }
    ]);
  });
});
