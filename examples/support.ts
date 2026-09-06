// Filesystem helpers for tests, separated from the browser-safe example manifest.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLES } from './manifest.js';

/** Directory holding the .gas documents. */
export const EXAMPLES_ROOT = fileURLToPath(new URL('./documents/', import.meta.url));

/** Lists example documents and rejects an empty directory or a mismatch with the manifest. */
export function exampleFiles(): string[] {
  const found = readdirSync(EXAMPLES_ROOT)
    .filter((entry) => entry.endsWith('.gas'))
    .sort();
  const declared = EXAMPLES.map((example) => `${example.name}.gas`).sort();

  const missing = declared.filter((name) => !found.includes(name));
  const undeclared = found.filter((name) => !declared.includes(name));
  if (missing.length > 0 || undeclared.length > 0) {
    throw new Error(
      `examples/documents does not match examples/manifest.ts.` +
        (missing.length > 0 ? ` Declared but not on disk: ${missing.join(', ')}.` : '') +
        (undeclared.length > 0 ? ` On disk but not declared: ${undeclared.join(', ')}.` : '') +
        ` Looked in ${EXAMPLES_ROOT}.`
    );
  }
  return found;
}

/** Reads a document after validating the complete example manifest against disk. */
export function readExample(name: string): string {
  const fileName = name.endsWith('.gas') ? name : `${name}.gas`;
  const available = exampleFiles();
  if (!available.includes(fileName)) {
    throw new Error(`No example document named ${fileName}. Available: ${available.join(', ')}.`);
  }
  return readFileSync(path.join(EXAMPLES_ROOT, fileName), 'utf8');
}
