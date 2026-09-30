// Keep the READMEs honest: no claim a release has since made false, and every package README
// in the shared layout, so a reader finds the same section in the same place on every npm page.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

function packageReadmes(): string[] {
  const packagesRoot = path.join(repoRoot, 'packages');
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesRoot, entry.name, 'README.md'))
    .sort();
}

const packageFiles = packageReadmes();
const allFiles = [
  path.join(repoRoot, 'README.md'),
  path.join(repoRoot, 'CONTRIBUTING.md'),
  ...packageFiles
];

const read = (file: string) => readFileSync(file, 'utf8');
const relative = (file: string) => path.relative(repoRoot, file);

// Each phrase was true once. Add a phrase here when a change makes a documented claim false.
const STALE_CLAIMS = [
  'compiled on the first',
  'share one release version',
  'no umbrella package',
  'subsequent runtime update',
  'still validates configuration with AJV',
  'also installs this connector',
  'first public preview'
];

// Package-specific sections may sit between Exports and Runtime support.
const TEMPLATE_SECTIONS = [
  '## Install',
  '## Example',
  '## Exports',
  '## Runtime support',
  '## Related packages',
  '## License'
];

test('the collector finds every package README', () => {
  // A checkout missing packages/ must not pass with zero cases.
  expect(packageFiles.length).toBeGreaterThanOrEqual(11);
});

describe('stale claims', () => {
  test.each(allFiles.map((file) => ({ file: relative(file), text: read(file) })))(
    '$file makes no stale claim',
    ({ text }) => {
      const found = STALE_CLAIMS.filter((claim) =>
        text.toLowerCase().includes(claim.toLowerCase())
      );
      expect(found).toEqual([]);
    }
  );
});

describe('package README layout', () => {
  test.each(packageFiles.map((file) => ({ file: relative(file), text: read(file) })))(
    '$file follows the shared layout',
    ({ text }) => {
      expect(text.startsWith('# @luna-estelar/gas')).toBe(true);
      const headings = text.split('\n').filter((line) => line.startsWith('## '));
      const present = TEMPLATE_SECTIONS.filter((section) => headings.includes(section));
      expect(present).toEqual(TEMPLATE_SECTIONS);
      const order = TEMPLATE_SECTIONS.map((section) => headings.indexOf(section));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  );
});
