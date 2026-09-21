// Check that exported version literals match their manifests. Literals support
// browser consumers without importing Node APIs or package metadata.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { version as apiVersion } from '../packages/api/src/index.js';
import { version as cliVersion } from '../packages/cli/src/index.js';
import { version as connectorVersion } from '../packages/connector-lyria/src/index.js';
import { version as coreVersion } from '../packages/core/src/index.js';
import { version as languageVersion } from '../packages/language/src/index.js';
import { version as notationVersion } from '../packages/notation/src/index.js';
import { version as protocolVersion } from '../packages/protocol/src/index.js';
import { version as rendererVersion } from '../packages/renderer/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootVersion = (
  JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version: string }
).version;

function manifestVersion(pkg: string): string {
  const file = path.join(here, '..', 'packages', pkg, 'package.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

const EXPORTED: ReadonlyArray<readonly [string, string]> = [
  ['api', apiVersion],
  ['cli', cliVersion],
  ['connector-lyria', connectorVersion],
  ['core', coreVersion],
  ['language', languageVersion],
  ['notation', notationVersion],
  ['protocol', protocolVersion],
  ['renderer', rendererVersion]
];

describe('exported version constants', () => {
  test('the private root matches every published package', () => {
    for (const pkg of [
      'api',
      'browser',
      'cli',
      'connector-lyria',
      'core',
      'highlight',
      'language',
      'notation',
      'protocol',
      'renderer'
    ]) {
      expect(manifestVersion(pkg), pkg).toBe(rootVersion);
    }
  });

  test.each(EXPORTED)('%s matches its package.json', (pkg, exported) => {
    expect(exported).toBe(manifestVersion(pkg));
  });

  // Highlight and browser expose no version constant.
  test('the packages that export one are the packages that have one', () => {
    const declared = EXPORTED.map(([pkg]) => pkg);
    expect(declared).toEqual([...declared].sort());
    expect(declared).toHaveLength(8);
  });
});
