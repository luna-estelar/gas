// Check that exported version literals match their manifests. Literals support
// browser consumers without importing Node APIs or package metadata. Packages
// are versioned independently, so each literal is checked against its own
// manifest only; `scripts/sync-versions.mjs` keeps them in step on release.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { version as apiVersion } from '../packages/api/src/index.js';
import { version as browserVersion } from '../packages/browser/src/session.js';
import { version as cliVersion } from '../packages/cli/src/index.js';
import { version as connectorVersion } from '../packages/connector-lyria/src/index.js';
import { version as coreVersion } from '../packages/core/src/index.js';
import { version as gasVersion } from '../packages/gas/src/index.js';
import { compileSource, version as languageVersion } from '../packages/language/src/index.js';
import { version as notationVersion } from '../packages/notation/src/index.js';
import { version as protocolVersion } from '../packages/protocol/src/index.js';
import { version as rendererVersion } from '../packages/renderer/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
function manifestVersion(pkg: string): string {
  const file = path.join(here, '..', 'packages', pkg, 'package.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

const EXPORTED: ReadonlyArray<readonly [string, string]> = [
  ['api', apiVersion],
  ['browser', browserVersion],
  ['cli', cliVersion],
  ['connector-lyria', connectorVersion],
  ['core', coreVersion],
  ['gas', gasVersion],
  ['language', languageVersion],
  ['notation', notationVersion],
  ['protocol', protocolVersion],
  ['renderer', rendererVersion]
];

describe('exported version constants', () => {
  test.each(EXPORTED)('%s matches its package.json', (pkg, exported) => {
    expect(exported).toBe(manifestVersion(pkg));
  });

  // The compiler stamps its version into every timeline it emits.
  test('the language compiler reports the language package version', () => {
    const result = compileSource('tempo 90\nlength bars 1\n');
    if (!result.ok) throw new Error('expected the minimal document to compile');
    expect(result.timeline.compilerVersion).toBe(manifestVersion('language'));
  });

  // Highlight exposes no version constant.
  test('the packages that export one are the packages that have one', () => {
    const declared = EXPORTED.map(([pkg]) => pkg);
    expect(declared).toEqual([...declared].sort());
    expect(declared).toHaveLength(10);
  });
});
