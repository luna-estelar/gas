import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script without type declarations
import { assertCoverage, collectAll, findViolations } from '../scripts/check-boundaries.mjs';

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

  it('allows the browser package to compose language and core', () => {
    const violations = findViolations([
      {
        package: 'browser',
        path: 'packages/browser/src/compile.ts',
        content:
          "import { compileSource } from '@luna-estelar/gas-language';\nimport { createInputState } from '@luna-estelar/gas-core';"
      }
    ]);
    expect(violations).toHaveLength(0);
  });

  it('confines concrete runtime imports to the unit wiring module regardless of path', () => {
    const content = "import { createRenderer } from '@luna-estelar/gas-renderer';";
    const ordinary = findViolations([
      {
        package: 'browser',
        path: 'src/playback.ts',
        content
      }
    ]);
    expect(ordinary).toHaveLength(1);

    const wiring = findViolations([
      {
        package: 'browser',
        path: 'src/wiring.ts',
        content
      }
    ]);
    expect(wiring).toHaveLength(0);

    const arbitraryPath = findViolations([
      {
        package: 'browser',
        path: 'anywhere/at/all/wiring.ts',
        content
      }
    ]);
    expect(arbitraryPath).toHaveLength(0);
  });

  // Astro frontmatter imports like any other module, so a page must not be able
  // to reach the concrete runtime just by not being a .ts file.
  it('holds the wiring rule for .astro pages too', () => {
    const page = findViolations([
      {
        package: 'browser',
        path: 'packages/browser/src/demo.astro',
        content: "import { createLyriaConnector } from '@luna-estelar/gas-connector-lyria';"
      }
    ]);
    expect(page).toHaveLength(1);
  });

  // Import text inside a rendered code sample is not an executable import.
  it('ignores a specifier inside a template literal', () => {
    const violations = findViolations([
      {
        package: 'host',
        scope: 'app',
        path: 'fixtures/host/src/components/home/Surfaces.astro',
        content: [
          '---',
          "import GasCode from '../GasCode.astro';",
          "const hostSource = `import { createSession } from '@luna-estelar/gas-api';",
          "import { createRenderer } from '@luna-estelar/gas-renderer';",
          "import { createLyriaConnector } from '@luna-estelar/gas-connector-lyria';`;",
          '---',
          '<GasCode code={hostSource} />'
        ].join('\n')
      }
    ]);
    expect(violations).toHaveLength(0);
  });

  // Mask code samples without hiding adjacent executable imports.
  it('still flags a real import that follows a sample', () => {
    const violations = findViolations([
      {
        package: 'host',
        scope: 'app',
        path: 'fixtures/host/src/islands/Playback.tsx',
        content: [
          "const sample = `import { createRenderer } from '@luna-estelar/gas-renderer';`;",
          "// Or: import { createRenderer } from '@luna-estelar/gas-renderer';",
          'const quoted = "import { createRenderer } from \'@luna-estelar/gas-renderer\'";',
          "import { createLyriaConnector } from '@luna-estelar/gas-connector-lyria';"
        ].join('\n')
      }
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].importedPackage).toBe('@luna-estelar/gas-connector-lyria');
  });

  // Only an .astro file's frontmatter and <script> blocks are module code; the
  // markup between them is prose. The <script> half still has to be scanned.
  it('holds the wiring rule inside an .astro <script> block', () => {
    const violations = findViolations([
      {
        package: 'host',
        scope: 'app',
        path: 'fixtures/host/src/components/Player.astro',
        content: [
          '---',
          "const label = 'Play';",
          '---',
          '<p>It\u2019s the player. Don\u2019t reach past the wiring.</p>',
          '<script>',
          "  import { createRenderer } from '@luna-estelar/gas-renderer';",
          '</script>'
        ].join('\n')
      }
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].importedPackage).toBe('@luna-estelar/gas-renderer');
  });

  // Apply the wiring rule to JSX components.
  it('holds the wiring rule for .jsx components too', () => {
    const component = findViolations([
      {
        package: 'host',
        scope: 'app',
        path: 'fixtures/host/src/design-system/components/Player/Player.jsx',
        content: "import { createRenderer } from '@luna-estelar/gas-renderer';"
      }
    ]);
    expect(component).toHaveLength(1);
  });

  it('finds no violations in the real workspace tree', async () => {
    expect(findViolations(await collectAll())).toEqual([]);
  });

  it('covers every declared unit in the real workspace tree', async () => {
    const counts = await assertCoverage(await collectAll());
    expect(counts.filter(({ count }) => count === 0).map(({ unit }) => unit)).toEqual([]);
  });
});
