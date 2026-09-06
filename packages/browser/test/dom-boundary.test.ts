// Restrict DOM access to the browser host modules that require it. Classify
// identifier uses to catch aliases and shadowing without matching comments or
// property names. fetch remains allowed as a shared Node/browser API.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

/** Include globalThis and self to catch indirect access such as globalThis.document. */
const FORBIDDEN = new Set([
  'document',
  'localStorage',
  'navigator',
  'window',
  'globalThis',
  'self'
]);

/** The one file allowed to touch a browser global, and nothing else. */
const WINDOW_FILE = 'playback.ts';

interface Violation {
  readonly line: number;
  readonly name: string;
  /** `reference` reads or writes the global; `shadow` binds a value over its name. */
  readonly kind: 'reference' | 'shadow';
}

function sourceFiles(directory = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * Classify an identifier by syntax position. Property names, type references and
 * labels return undefined. Type-space cases are explicit because
 * isPartOfTypeNode does not cover QualifiedName.left or TypeQuery.exprName.
 */
function classifyIdentifier(node: ts.Identifier): Violation['kind'] | undefined {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return 'reference';

  // --- Names of members, keys and labels: never the global. ---
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return undefined;
  if (ts.isQualifiedName(parent)) return undefined;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return undefined;
  // `const { localStorage: alias } = x` — this reads a key off x. The hazard in
  // that line is x itself, which is classified separately.
  if (ts.isBindingElement(parent) && parent.propertyName === node) return undefined;
  if (
    (ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === node
  ) {
    return undefined;
  }
  if (ts.isLabeledStatement(parent) && parent.label === node) return undefined;
  if ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node) {
    return undefined;
  }
  // Both fields: `export { x as document }` names an export, and
  // `export { document } from './a'` names another module's. A local binding
  // behind a bare re-export is reported at its declaration instead.
  if (ts.isExportSpecifier(parent)) return undefined;
  if (ts.isImportSpecifier(parent) && parent.propertyName === node) return undefined;

  // --- Type space: erased, and cannot capture a value reference. ---
  if (ts.isTypeReferenceNode(parent) && parent.typeName === node) return undefined;
  // `type D = typeof document` is a TypeQueryNode and emits nothing. The
  // expression form `typeof window !== 'undefined'` is a TypeOfExpression — a
  // different node that falls through to `reference`. The two read identically.
  if (ts.isTypeQueryNode(parent) && parent.exprName === node) return undefined;
  if (
    (ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isTypeParameterDeclaration(parent)) &&
    parent.name === node
  ) {
    return undefined;
  }

  // Reject bindings that shadow a forbidden global; this check does not resolve scopes.
  if (
    (ts.isVariableDeclaration(parent) || // covers catch(document) and for (const document of …)
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isModuleDeclaration(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isImportEqualsDeclaration(parent)) &&
    parent.name === node
  ) {
    return 'shadow';
  }
  if (ts.isBindingElement(parent) && parent.name === node) return 'shadow';

  // Remaining positions read the global, including aliases, typeof and shorthand properties.
  return 'reference';
}

/** Every forbidden global this source reaches, in source order. */
function domViolations(source: ts.SourceFile, relative: string): Violation[] {
  const violations: Violation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && FORBIDDEN.has(node.text)) {
      const kind = classifyIdentifier(node);
      if (kind !== undefined && !isAllowed(node, kind, relative)) {
        violations.push({
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          name: node.text,
          kind
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

/** Allow window member access in playback.ts, but reject bare references and shadowing. */
function isAllowed(node: ts.Identifier, kind: Violation['kind'], relative: string): boolean {
  if (relative !== WINDOW_FILE || node.text !== 'window' || kind !== 'reference') return false;
  const parent = node.parent as ts.Node | undefined;
  return (
    parent !== undefined && ts.isPropertyAccessExpression(parent) && parent.expression === node
  );
}

function parse(text: string, name = 'probe.ts'): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

describe('browser-global boundary', () => {
  it('keeps browser globals out of the framework-free host', () => {
    const violations = sourceFiles().flatMap((file) => {
      const relative = path.relative(sourceRoot, file).split(path.sep).join('/');
      const source = parse(readFileSync(file, 'utf8'), file);
      return domViolations(source, relative).map(
        ({ line, name, kind }) => `${relative}:${line} ${kind} ${name}`
      );
    });
    expect(violations).toEqual([]);
  });

  // One case per line, so the asserted line number is also the case number.
  it('flags every form that reaches a browser global', () => {
    const source = parse(
      [
        'void document.title;', // 1
        'void document["title"];', // 2
        'const direct = document; void direct;', // 3 — the three forms the
        'const { localStorage: alias } = window; void alias;', // 4   receiver-only rule
        'if (typeof window !== "undefined") { void 1; }', // 5   used to miss
        'void globalThis.document;', // 6 — the bypass globalThis closes
        'void self.document;', // 7
        'const shorthand = { localStorage }; void shorthand;', // 8
        'const holder = { key: navigator }; void holder;', // 9
        'void `${document}`;', // 10
        'void (document as unknown);', // 11
        'const later = () => window; void later;', // 12
        'const document = fake; void document;', // 13 — shadow lines report twice
        'function take(navigator: unknown) { return navigator; }', // 14
        'const { localStorage } = fake; void localStorage;' // 15
      ].join('\n')
    );

    expect(domViolations(source, 'config.ts')).toEqual([
      { line: 1, name: 'document', kind: 'reference' },
      { line: 2, name: 'document', kind: 'reference' },
      { line: 3, name: 'document', kind: 'reference' },
      { line: 4, name: 'window', kind: 'reference' },
      { line: 5, name: 'window', kind: 'reference' },
      { line: 6, name: 'globalThis', kind: 'reference' },
      { line: 7, name: 'self', kind: 'reference' },
      { line: 8, name: 'localStorage', kind: 'reference' },
      { line: 9, name: 'navigator', kind: 'reference' },
      { line: 10, name: 'document', kind: 'reference' },
      { line: 11, name: 'document', kind: 'reference' },
      { line: 12, name: 'window', kind: 'reference' },
      { line: 13, name: 'document', kind: 'shadow' },
      { line: 13, name: 'document', kind: 'reference' },
      { line: 14, name: 'navigator', kind: 'shadow' },
      { line: 14, name: 'navigator', kind: 'reference' },
      { line: 15, name: 'localStorage', kind: 'shadow' },
      { line: 15, name: 'localStorage', kind: 'reference' }
    ]);
  });

  it('leaves member names, type positions and prose alone', () => {
    const source = parse(
      [
        'void frame.contentWindow;', // the real bitsy/bridge.ts idiom
        'void payload.document;',
        'void payload?.navigator;',
        'const config = { document: 1 }; void config;',
        'const { document: renamed } = payload; void renamed;',
        'interface Frame { readonly document: unknown; readonly contentWindow: unknown }',
        'class Holder { private readonly navigator = 1; document() {} get window() { return 1; } }',
        'type Alias = document.Thing;',
        'let typed: navigator; void typed;',
        'type Queried = typeof document;',
        'outer: for (;;) { break outer; }',
        '// window.document.localStorage, named in a comment',
        '/** JSDoc naming window, document and navigator. */',
        'export { renamedOut as document } from "./shim.js";',
        'enum Kind { document }'
      ].join('\n')
    );
    expect(domViolations(source, 'config.ts')).toEqual([]);
  });

  it('confines the window allowance to playback.ts, and to member access', () => {
    const source = parse(
      [
        'window.setTimeout(cb, 0);',
        'window.clearTimeout(0);',
        'void window.requestAnimationFrame;', // not pinned to the timer methods
        'const captured = window; void captured;',
        'void document.title;'
      ].join('\n')
    );

    expect(domViolations(source, 'playback.ts')).toEqual([
      { line: 4, name: 'window', kind: 'reference' },
      { line: 5, name: 'document', kind: 'reference' }
    ]);
    expect(domViolations(source, 'config.ts')).toEqual([
      { line: 1, name: 'window', kind: 'reference' },
      { line: 2, name: 'window', kind: 'reference' },
      { line: 3, name: 'window', kind: 'reference' },
      { line: 4, name: 'window', kind: 'reference' },
      { line: 5, name: 'document', kind: 'reference' }
    ]);
  });
});
