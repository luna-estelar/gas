// Compile GAS fences, parse live fences and typecheck TypeScript README examples.
// Fragment fences are illustrative excerpts and are excluded.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { compileSource, parseLiveCommands } from '../packages/language/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

function readmeFiles(): string[] {
  const files = [path.join(repoRoot, 'README.md')];
  const packagesRoot = path.join(repoRoot, 'packages');
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const readme = path.join(packagesRoot, entry.name, 'README.md');
    try {
      readFileSync(readme);
      files.push(readme);
    } catch {
      // packaging.test.ts checks for missing READMEs.
    }
  }
  return files.sort();
}

interface Snippet {
  readonly file: string;
  readonly lang: string;
  readonly code: string;
}

const FENCE = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g;

const snippets: Snippet[] = [];
for (const file of readmeFiles()) {
  const source = readFileSync(file, 'utf8');
  let match: RegExpExecArray | null;
  while ((match = FENCE.exec(source)) !== null) {
    snippets.push({ file: path.relative(repoRoot, file), lang: match[1]!, code: match[2]! });
  }
}

const compileSnippets = snippets.filter((snippet) => snippet.lang === 'gas');
const liveSnippets = snippets.filter((snippet) => snippet.lang === 'gas-live');
const tsSnippets = snippets.filter((snippet) => snippet.lang === 'ts');

function errorText(diagnostics: readonly { severity: string; code: string; message: string }[]) {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
    .join('\n');
}

describe('README GAS snippets', () => {
  test('the READMEs contain checkable GAS snippets', () => {
    expect(compileSnippets.length + liveSnippets.length).toBeGreaterThan(0);
  });

  test.each(compileSnippets)('$file — ```gas compiles', ({ code }) => {
    const result = compileSource(code);
    expect(result.ok, errorText(result.diagnostics)).toBe(true);
  });

  test.each(liveSnippets)('$file — ```gas-live parses', ({ code }) => {
    const result = parseLiveCommands(code);
    expect(result.ok, errorText(result.diagnostics)).toBe(true);
  });
});

// Typecheck against built declarations. Explicit mappings account for package
// directory names and exported subpaths.

const PACKAGE_DIRS: Readonly<Record<string, string>> = {
  'gas-protocol': 'protocol',
  'gas-language': 'language',
  'gas-highlight': 'highlight',
  'gas-notation': 'notation',
  'gas-core': 'core',
  'gas-renderer': 'renderer',
  'gas-api': 'api',
  'gas-connector-lyria': 'connector-lyria',
  'gas-cli': 'cli'
};

let scratch: string | undefined;

afterAll(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
});

/** Typechecks every snippet in one tsc pass; returns errors keyed by snippet index. */
function typecheckSnippets(items: readonly Snippet[]): Map<number, string> {
  const failures = new Map<number, string>();
  if (items.length === 0) return failures;

  scratch = mkdtempSync(path.join(os.tmpdir(), 'gas-readme-ts-'));
  const include = items.map((snippet, index) => {
    const name = `snippet-${index}.ts`;
    writeFileSync(path.join(scratch!, name), snippet.code, 'utf8');
    return name;
  });

  const paths: Record<string, string[]> = {};
  for (const [pkg, dir] of Object.entries(PACKAGE_DIRS)) {
    paths[`@luna-estelar/${pkg}`] = [path.join(repoRoot, 'packages', dir, 'out', 'index.d.ts')];
  }
  paths['@luna-estelar/gas-protocol/validation'] = [
    path.join(repoRoot, 'packages', 'protocol', 'out', 'validation.d.ts')
  ];
  paths['@luna-estelar/gas-browser/*'] = [
    path.join(repoRoot, 'packages', 'browser', 'out', '*.d.ts')
  ];

  writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');

  writeFileSync(
    path.join(scratch, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'nodenext',
        lib: ['ES2022', 'DOM'],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
        baseUrl: '.',
        paths
      },
      include
    }),
    'utf8'
  );

  try {
    execFileSync(path.join(repoRoot, 'node_modules', '.bin', 'tsc'), ['-p', scratch], {
      encoding: 'utf8',
      stdio: 'pipe'
    });
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string };
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    for (const line of output.split('\n')) {
      const match = /snippet-(\d+)\.ts\(/.exec(line);
      if (match === null) continue;
      const index = Number(match[1]);
      failures.set(index, `${failures.get(index) ?? ''}${line.trim()}\n`);
    }
  }
  return failures;
}

const tsFailures = typecheckSnippets(tsSnippets);

describe('README TypeScript snippets', () => {
  test('the READMEs contain checkable TypeScript snippets', () => {
    expect(tsSnippets.length).toBeGreaterThan(0);
  });

  test.each(tsSnippets.map((snippet, index) => ({ ...snippet, index })))(
    '$file — ```ts typechecks',
    ({ index }) => {
      expect(tsFailures.get(index) ?? '').toBe('');
    }
  );
});
