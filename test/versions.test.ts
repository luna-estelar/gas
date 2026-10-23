// Each published package has one version literal, and it matches the manifest.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { execute, type CliIo } from '../packages/gas/src/cli/index.js';
import { compileSource } from '../packages/gas/src/language/index.js';
import { version as gasVersion } from '../packages/gas/src/version.js';
import { version as lyriaVersion } from '../packages/lyria-rt/src/index.js';
import { version as magentaVersion } from '../packages/magenta-rt2/src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function manifestVersion(pkg: string): string {
  const file = path.join(root, 'packages', pkg, 'package.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('gas version', () => {
  test('src/version.ts matches the manifest', () => {
    expect(gasVersion).toBe(manifestVersion('gas'));
  });

  // The compiler stamps the package version into every timeline it emits.
  test('compiled timelines carry it as compilerVersion', () => {
    const result = compileSource('tempo 90\nlength bars 1\n');
    if (!result.ok) throw new Error('expected the minimal document to compile');
    expect(result.timeline.compilerVersion).toBe(manifestVersion('gas'));
  });

  test('gas --version prints it', () => {
    const stdout: string[] = [];
    const io: CliIo = {
      readFile: () => '',
      writeFile: () => undefined,
      stdout: (value) => stdout.push(value),
      stderr: () => undefined
    };
    expect(execute(['--version'], io)).toBe(0);
    expect(stdout).toEqual([`${manifestVersion('gas')}\n`]);
  });
});

describe('lyria version', () => {
  test('src/index.ts matches the manifest', () => {
    expect(lyriaVersion).toBe(manifestVersion('lyria-rt'));
  });
});

describe('magenta-rt2 version', () => {
  test('src/index.ts matches the manifest', () => {
    expect(magentaVersion).toBe(manifestVersion('magenta-rt2'));
  });
});

// Discovered from the filesystem, so a module literal cannot come back unnoticed.
test('only the package literals exist', () => {
  const literal = /^export const version\b/m;
  const found = ['gas', 'lyria-rt', 'magenta-rt2']
    .flatMap((pkg) => sourceFiles(path.join(root, 'packages', pkg, 'src')))
    .filter((file) => literal.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort();
  expect(found).toEqual([
    'packages/gas/src/version.ts',
    'packages/lyria-rt/src/index.ts',
    'packages/magenta-rt2/src/index.ts'
  ]);
});
