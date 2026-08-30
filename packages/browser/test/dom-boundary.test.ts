import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const forbiddenEverywhere = new Set(['document', 'localStorage', 'navigator']);

function sourceFiles(directory = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('browser-global boundary', () => {
  it('keeps broad DOM access out of the framework-free host', () => {
    const violations: string[] = [];

    for (const file of sourceFiles()) {
      const relative = path.relative(sourceRoot, file).split(path.sep).join('/');
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );
      const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
          const receiver = node.expression;
          if (ts.isIdentifier(receiver)) {
            const name = receiver.text;
            if (
              forbiddenEverywhere.has(name) ||
              (name === 'window' && relative !== 'playback.ts')
            ) {
              const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
              violations.push(`${relative}:${line} uses ${name}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(violations).toEqual([]);
  });
});
