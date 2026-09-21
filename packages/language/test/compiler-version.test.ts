import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { compileSource } from '../src/index.js';

// Check the browser-compatible compiler version literal against the package manifest.

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as {
  version: string;
};

describe('compilerVersion', () => {
  test('matches the language package version', () => {
    const result = compileSource('tempo 90\nlength bars 1\n');
    if (!result.ok) {
      throw new Error(
        `Expected a compiled timeline, got: ${result.diagnostics.map((d) => d.code).join(', ')}`
      );
    }
    expect(result.timeline.compilerVersion).toBe(manifest.version);
  });
});
