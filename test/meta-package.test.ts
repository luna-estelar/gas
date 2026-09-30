// The umbrella package @luna-estelar/gas: what it depends on, what each entry
// point exposes, what importing it loads, and how its releases track the
// packages it pins.
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const umbrellaRoot = path.join(root, 'packages', 'gas');
const UMBRELLA = '@luna-estelar/gas';

interface Manifest {
  readonly name: string;
  readonly dependencies?: Record<string, string>;
  readonly exports: Record<string, { readonly types: string; readonly default: string }>;
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as Manifest;
}

const umbrella = readManifest(umbrellaRoot);
const siblings = readdirSync(path.join(root, 'packages'))
  .filter((dir) => dir !== 'gas')
  .map((dir) => readManifest(path.join(root, 'packages', dir)).name)
  .sort();

/** Each subpath and the package entry it mirrors; the root mirrors the api. */
const MIRRORS: Readonly<Record<string, string>> = {
  '.': '@luna-estelar/gas-api',
  './protocol': '@luna-estelar/gas-protocol',
  './protocol/validation': '@luna-estelar/gas-protocol/validation',
  './language': '@luna-estelar/gas-language',
  './core': '@luna-estelar/gas-core',
  './api': '@luna-estelar/gas-api',
  './renderer': '@luna-estelar/gas-renderer',
  './notation': '@luna-estelar/gas-notation',
  './highlight': '@luna-estelar/gas-highlight',
  './lyria': '@luna-estelar/gas-connector-lyria',
  './browser/session': '@luna-estelar/gas-browser/session',
  './browser/audio': '@luna-estelar/gas-browser/audio',
  './browser/capture': '@luna-estelar/gas-browser/capture',
  './browser/compile': '@luna-estelar/gas-browser/compile',
  './browser/timeline': '@luna-estelar/gas-browser/timeline',
  './browser/inspect': '@luna-estelar/gas-browser/inspect'
};

// A checked-in list, so any change to what an entry point exposes shows up in
// review rather than arriving silently through a star export.
const EXPECTED_NAMES = JSON.parse(
  readFileSync(path.join(root, 'test', 'meta-package-exports.json'), 'utf8')
) as Record<string, string[]>;

async function namesOf(url: string): Promise<string[]> {
  return Object.keys((await import(url)) as object).sort();
}

describe('umbrella manifest', () => {
  it('depends on every other workspace package at an exact version', () => {
    expect(Object.keys(umbrella.dependencies ?? {}).sort()).toEqual(siblings);
    for (const range of Object.values(umbrella.dependencies ?? {})) {
      expect(range).toBe('workspace:*');
    }
  });

  it('exposes the root and one subpath per package entry, and nothing else', () => {
    expect(Object.keys(umbrella.exports).sort()).toEqual(Object.keys(MIRRORS).sort());
  });
});

describe('umbrella entry points', () => {
  const resolveFromUmbrella = createRequire(path.join(umbrellaRoot, 'package.json'));

  it.each(Object.keys(MIRRORS))('%s exposes its checked-in names', async (subpath) => {
    const target = path.join(umbrellaRoot, umbrella.exports[subpath]!.default);
    expect(await namesOf(pathToFileURL(target).href)).toEqual(EXPECTED_NAMES[subpath]);
  });

  it.each(Object.keys(MIRRORS).filter((subpath) => subpath !== '.'))(
    '%s mirrors its package exactly',
    async (subpath) => {
      const target = path.join(umbrellaRoot, umbrella.exports[subpath]!.default);
      const mirrored = pathToFileURL(resolveFromUmbrella.resolve(MIRRORS[subpath]!)).href;
      expect(await namesOf(pathToFileURL(target).href)).toEqual(await namesOf(mirrored));
    }
  );

  // The root is the api plus its own identity; the api's packageName and
  // version are shadowed rather than dropped.
  it('the root is the api with its own package name and version', async () => {
    const rootModule = (await import(
      pathToFileURL(path.join(umbrellaRoot, umbrella.exports['.']!.default)).href
    )) as { packageName: string };
    expect(rootModule.packageName).toBe(UMBRELLA);
    expect(EXPECTED_NAMES['.']).toEqual(EXPECTED_NAMES['./api']);
  });
});

// Each import runs in its own process from the umbrella's directory, under a
// resolve hook that throws on the SDK, because only a module graph's first
// evaluation can be observed.
describe('the Google GenAI SDK', () => {
  const hook = path.join(root, 'test', 'support', 'deny-genai.mjs');

  async function importUnderHook(specifier: string): Promise<void> {
    await run(
      process.execPath,
      [
        '--import',
        pathToFileURL(hook).href,
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(specifier)});`
      ],
      { cwd: umbrellaRoot }
    );
  }

  const specifiers = Object.keys(MIRRORS).map((subpath) =>
    subpath === '.' ? UMBRELLA : `${UMBRELLA}/${subpath.slice(2)}`
  );

  it.concurrent.each(specifiers.filter((specifier) => specifier !== `${UMBRELLA}/lyria`))(
    'is not loaded by %s',
    async (specifier) => {
      await expect(importUnderHook(specifier)).resolves.toBeUndefined();
    }
  );

  // Without this the hook could be broken and every case above would still pass.
  it('is loaded by the lyria subpath, which the hook catches', async () => {
    await expect(importUnderHook(`${UMBRELLA}/lyria`)).rejects.toThrow('@google/genai was loaded');
  });
});

// The boundary check lets two umbrella modules reach the concrete runtimes.
// That is safe only while the package is a pure facade.
describe('umbrella sources', () => {
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });
  }

  const IDENTITY = new Set(['packageName', 'version']);

  function isReExport(statement: ts.Statement): boolean {
    return (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      statement.exportClause === undefined
    );
  }

  function isIdentityConstant(statement: ts.Statement): boolean {
    if (!ts.isVariableStatement(statement)) return false;
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    );
    return (
      exported === true &&
      statement.declarationList.declarations.every(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          IDENTITY.has(declaration.name.text) &&
          declaration.initializer !== undefined &&
          ts.isStringLiteral(declaration.initializer)
      )
    );
  }

  it.each(
    sourceFiles(path.join(umbrellaRoot, 'src')).map((file) => path.relative(umbrellaRoot, file))
  )('%s only re-exports', (file) => {
    const source = ts.createSourceFile(
      file,
      readFileSync(path.join(umbrellaRoot, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const allowed = file === path.join('src', 'index.ts') ? isIdentityConstant : () => false;
    for (const statement of source.statements) {
      expect(isReExport(statement) || allowed(statement), statement.getText()).toBe(true);
    }
  });
});

// Changesets always releases an exact-pinning dependent as a patch. A breaking
// change underneath the umbrella would then reach its users as a patch, so any
// minor or major on a package it pins must carry the same bump for the
// umbrella itself.
describe('pending changesets', () => {
  const RANK: Readonly<Record<string, number>> = { patch: 1, minor: 2, major: 3 };

  function pendingBumps(): Map<string, number> {
    const dir = path.join(root, '.changeset');
    const bumps = new Map<string, number>();
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md') || file === 'README.md') continue;
      const text = readFileSync(path.join(dir, file), 'utf8');
      const frontMatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
      for (const line of frontMatter.split('\n')) {
        const match = /^\s*['"]?([^'":]+)['"]?\s*:\s*(patch|minor|major)\s*$/.exec(line);
        if (match === null) continue;
        const [, name, bump] = match;
        bumps.set(name!, Math.max(bumps.get(name!) ?? 0, RANK[bump!]!));
      }
    }
    return bumps;
  }

  it('bump the umbrella at least as far as any breaking change it pins', () => {
    const bumps = pendingBumps();
    const needed = Math.max(
      0,
      ...siblings.map((name) => bumps.get(name) ?? 0).filter((rank) => rank >= RANK.minor!)
    );
    expect(bumps.get(UMBRELLA) ?? 0).toBeGreaterThanOrEqual(needed);
  });
});
