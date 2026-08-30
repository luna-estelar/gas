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
    const imports = sourceFiles().flatMap((file) => {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );
      return source.statements.flatMap((statement) => {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
          return [];
        }
        if (!statement.moduleSpecifier.text.startsWith('@luna-estelar/gas-language')) return [];
        return [
          {
            file: path.relative(sourceRoot, file).split(path.sep).join('/'),
            value: importHasValue(statement.importClause)
          }
        ];
      });
    });

    expect(imports.filter(({ value }) => value).map(({ file }) => file)).toEqual(['compile.ts']);
    expect(imports.filter(({ file }) => file !== 'compile.ts').every(({ value }) => !value)).toBe(
      true
    );
  });
});
