// Check package metadata, licenses, documentation and built entrypoints before publication.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const packagesRoot = path.join(here, '..', 'packages');

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
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
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

// Every package, private or not, so lyria is ready to publish the moment its
// private flag is removed.
describe('packages', () => {
  test('there are exactly gas and lyria', () => {
    expect(packages.map((pkg) => pkg.dir)).toEqual(['gas', 'lyria']);
  });

  test('gas publishes, and lyria publishes once it is no longer private', () => {
    const lyria = packages.find((pkg) => pkg.dir === 'lyria')!;
    const publishable = packages
      .filter((pkg) => pkg.manifest.private !== true)
      .map((pkg) => pkg.manifest.name);
    expect(publishable).toEqual([
      '@luna-estelar/gas',
      ...(lyria.manifest.private === true ? [] : ['@luna-estelar/gas-lyria'])
    ]);
  });

  test.each(packages)('$manifest.name carries its own LICENSE', ({ root }) => {
    // npm auto-includes a LICENSE from the package directory and nowhere else,
    // so the root licence does not travel with the tarball.
    expect(exists(path.join(root, 'LICENSE'))).toBe(true);
  });

  test.each(packages)('$manifest.name carries a README', ({ root }) => {
    // Without one the npm page is blank.
    expect(exists(path.join(root, 'README.md'))).toBe(true);
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

    const required = { ...manifest.dependencies, ...manifest.peerDependencies };
    for (const dependency of Object.keys(required)) {
      const sibling = byName.get(dependency);
      if (sibling === undefined) continue;
      const siblingFloor = minimumMajor(sibling.manifest.engines?.node);
      expect(
        floor,
        `${manifest.name} allows Node ${floor} but depends on ${dependency}, which needs ${siblingFloor}`
      ).toBeGreaterThanOrEqual(siblingFloor);
    }
  });

  test('gas depends on no other @luna-estelar package', () => {
    const { manifest } = byName.get('@luna-estelar/gas')!;
    const internal = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies
    }).filter((name) => name.startsWith('@luna-estelar/'));
    expect(internal).toEqual([]);
  });

  test('lyria peers on gas and develops against the workspace copy', () => {
    // A peer, not a dependency: a host with two copies of gas would have two
    // ConnectorError classes, and instanceof checks would fail across them.
    // The range is written out because on 0.x `^0.3.0` means `<0.4.0`, which
    // would force a lyria release for every gas minor.
    const { manifest } = byName.get('@luna-estelar/gas-lyria')!;
    expect(manifest.peerDependencies?.['@luna-estelar/gas']).toBe('>=0.3.0 <1.0.0');
    expect(manifest.devDependencies?.['@luna-estelar/gas']).toBe('workspace:^');
    const runtime = Object.keys(manifest.dependencies ?? {}).filter((name) =>
      name.startsWith('@luna-estelar/')
    );
    expect(runtime).toEqual([]);
  });
});
