// Copies each package's manifest version into the version literals its source
// exports. The literals exist so browser consumers can read a version without
// loading package metadata, but `changeset version` only rewrites manifests, so
// the Version Packages PR would otherwise ship stale literals.
//
// `pnpm version-packages` runs this after `changeset version`. With `--check` it
// only reports literals that disagree with their manifests.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.join(root, 'packages');

// Each target is a source file and the declaration whose string literal must
// equal the owning package's version.
const LITERALS = [
  { file: 'src/index.ts', pattern: /^(export const version = ')([^']*)(';)$/m },
  // The browser package has no root entry; its session module carries the literal.
  { pkg: 'browser', file: 'src/session.ts', pattern: /^(export const version = ')([^']*)(';)$/m },
  // The language compiler stamps this into every timeline it emits.
  {
    pkg: 'language',
    file: 'src/compiler/compile.ts',
    pattern: /^(const COMPILER_VERSION = ')([^']*)(';)$/m
  }
];

export async function syncVersions({ write = false } = {}) {
  const stale = [];
  for (const pkg of (await readdir(packagesRoot)).sort()) {
    const manifestPath = path.join(packagesRoot, pkg, 'package.json');
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const literal of LITERALS) {
      if (literal.pkg !== undefined && literal.pkg !== pkg) continue;
      const file = path.join(packagesRoot, pkg, literal.file);
      let source;
      try {
        source = await readFile(file, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      const match = literal.pattern.exec(source);
      if (match === null || match[2] === manifest.version) continue;
      stale.push({ file: path.relative(root, file), from: match[2], to: manifest.version });
      if (write) {
        await writeFile(file, source.replace(literal.pattern, `$1${manifest.version}$3`));
      }
    }
  }
  return stale;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    console.error('usage: node scripts/sync-versions.mjs [--check]');
    process.exit(2);
  }
  const check = args[0] === '--check';
  const stale = await syncVersions({ write: !check });
  for (const { file, from, to } of stale) {
    console.log(`${check ? 'stale' : 'updated'}: ${file} ${from} -> ${to}`);
  }
  if (check && stale.length > 0) process.exit(1);
}
