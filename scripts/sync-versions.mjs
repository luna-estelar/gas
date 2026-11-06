// Copies each published package's manifest version into its one version
// literal. The literals exist so consumers can read a version without loading
// package metadata, but `changeset version` only rewrites manifests, so the
// release preparation would otherwise leave stale literals.
//
// `pnpm version-packages` runs this after `changeset version`. With `--check` it
// only reports literals that disagree with their manifests.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.join(root, 'packages');

const PATTERN = /^(export const version = ')([^']*)(';)$/m;

// Each target names its package directory and the source file whose literal
// must equal that package's version. GAS stamps its literal into the CLI and
// every compiled timeline. The targets are explicit, so a missing file or
// literal is an error rather than something to skip.
const LITERALS = [
  { pkg: 'gas', file: 'src/version.ts' },
  { pkg: 'lyria-rt', file: 'src/index.ts' },
  { pkg: 'magenta-rt2', file: 'src/index.ts' }
];

export async function syncVersions({ write = false } = {}) {
  const stale = [];
  for (const { pkg, file } of LITERALS) {
    const manifest = JSON.parse(
      await readFile(path.join(packagesRoot, pkg, 'package.json'), 'utf8')
    );
    const target = path.join(packagesRoot, pkg, file);
    const source = await readFile(target, 'utf8');
    const match = PATTERN.exec(source);
    if (match === null) {
      throw new Error(`${path.relative(root, target)} has no \`export const version\` literal.`);
    }
    if (match[2] === manifest.version) continue;
    stale.push({ file: path.relative(root, target), from: match[2], to: manifest.version });
    if (write) await writeFile(target, source.replace(PATTERN, `$1${manifest.version}$3`));
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
