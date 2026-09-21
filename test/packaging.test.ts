// Check package metadata, licenses, documentation and built entrypoints before publication.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const packagesRoot = path.join(here, '..', 'packages');
const rootManifest = JSON.parse(
  readFileSync(path.join(here, '..', 'package.json'), 'utf8')
) as Manifest;

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly private?: boolean;
  readonly files?: readonly string[];
  readonly exports?: unknown;
  readonly main?: string;
  readonly types?: string;
  readonly publishConfig?: { readonly access?: string };
  readonly repository?: { readonly directory?: string };
  readonly engines?: { readonly node?: string };
  readonly dependencies?: Readonly<Record<string, string>>;
}

interface Package {
  readonly dir: string;
  readonly root: string;
  readonly manifest: Manifest;
}

const packages: Package[] = readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const root = path.join(packagesRoot, entry.name);
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as Manifest;
    return { dir: entry.name, root, manifest };
  })
  .filter((pkg) => pkg.manifest.private !== true)
  .sort((a, b) => a.dir.localeCompare(b.dir));

function exists(file: string): boolean {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}

const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));

/** The major version a `>=X.Y.Z` range admits, or 0 when there is no range. */
function minimumMajor(range: string | undefined): number {
  if (range === undefined) return 0;
  const match = /(\d+)/.exec(range);
  return match === null ? 0 : Number(match[1]);
}

/** Every string leaf of the `exports` tree, minus wildcard patterns. */
function exportTargets(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    if (!node.includes('*')) out.push(node);
  } else if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) exportTargets(value, out);
  }
  return out;
}

describe('publishable packages', () => {
  test('there are ten of them', () => {
    expect(packages).toHaveLength(10);
  });

  test.each(packages)('$manifest.name carries its own LICENSE', ({ root }) => {
    // npm auto-includes a LICENSE from the package directory and nowhere else,
    // so the root licence does not travel with the tarball.
    expect(exists(path.join(root, 'LICENSE'))).toBe(true);
  });

  test.each(packages)('$manifest.name carries a README', ({ root }) => {
    // Without one the npm page is blank.
    const readme = path.join(root, 'README.md');
    expect(exists(readme)).toBe(true);
    expect(readFileSync(readme, 'utf8').trim().length).toBeGreaterThan(200);
  });

  test.each(packages)('$manifest.name documents its installation', ({ root, manifest }) => {
    const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
    expect(readme).toContain(`npm install ${manifest.name}`);
  });

  test.each(packages)('$manifest.name declares MIT and public access', ({ manifest }) => {
    expect(manifest.license).toBe('MIT');
    expect(manifest.publishConfig?.access).toBe('public');
  });

  test.each(packages)(
    '$manifest.name points repository.directory at itself',
    ({ dir, manifest }) => {
      // Relative npm README links depend on the package repository directory.
      expect(manifest.repository?.directory).toBe(`packages/${dir}`);
    }
  );

  test.each(packages)(
    '$manifest.name resolves every entry point it advertises',
    ({ root, manifest }) => {
      const targets = [
        ...exportTargets(manifest.exports),
        ...(manifest.main === undefined ? [] : [manifest.main]),
        ...(manifest.types === undefined ? [] : [manifest.types])
      ];
      expect(targets.length).toBeGreaterThan(0);
      const missing = targets.filter((target) => !exists(path.join(root, target)));
      expect(missing).toEqual([]);
    }
  );

  test.each(packages)('$manifest.name ships every path in its files list', ({ root, manifest }) => {
    const files = manifest.files ?? [];
    expect(files.length).toBeGreaterThan(0);
    const missing = files.filter((entry) => !exists(path.join(root, entry)));
    expect(missing).toEqual([]);
  });

  test.each(packages)('$manifest.name declares a Node floor it can honour', ({ manifest }) => {
    // The declared Node floor must cover installed dependencies, including type-only dependencies.
    const floor = minimumMajor(manifest.engines?.node);
    expect(floor, `${manifest.name} declares no Node floor`).toBeGreaterThan(0);

    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      const sibling = byName.get(dependency);
      if (sibling === undefined) continue;
      const siblingFloor = minimumMajor(sibling.manifest.engines?.node);
      expect(
        floor,
        `${manifest.name} allows Node ${floor} but depends on ${dependency}, which needs ${siblingFloor}`
      ).toBeGreaterThanOrEqual(siblingFloor);
    }
  });

  test('every package is at the same version', () => {
    const versions = [...new Set(packages.map((pkg) => pkg.manifest.version))];
    // pnpm rewrites workspace:* to the concrete version at pack time, so a
    // package left behind publishes dependencies that cannot resolve.
    expect(versions).toHaveLength(1);
    expect(versions[0]).toBe(rootManifest.version);
  });
});
