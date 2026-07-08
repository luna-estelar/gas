import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script without type declarations
import { findViolations } from '../scripts/check-boundaries.mjs';

describe('check-boundaries', () => {
  it('flags a forbidden cross-package import', () => {
    const violations = findViolations([
      {
        package: 'renderer',
        path: 'packages/renderer/src/index.ts',
        content: "import { x } from '@luna-estelar/gas-connector-lyria';"
      }
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].importedPackage).toBe('@luna-estelar/gas-connector-lyria');
  });

  it('allows an import permitted by the dependency direction', () => {
    const violations = findViolations([
      {
        package: 'language',
        path: 'packages/language/src/index.ts',
        content: "import { y } from '@luna-estelar/gas-protocol';"
      }
    ]);
    expect(violations).toHaveLength(0);
  });

  it('ignores non-GAS imports', () => {
    const violations = findViolations([
      {
        package: 'core',
        path: 'packages/core/src/index.ts',
        content: "import { describe } from 'vitest';\nimport path from 'node:path';"
      }
    ]);
    expect(violations).toHaveLength(0);
  });
});
