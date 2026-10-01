import { execFile } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script without type declarations
import { assertCoverage, collectAll, findViolations } from '../scripts/check-boundaries.mjs';
// @ts-expect-error -- plain ESM script without type declarations
import {
  ALLOW_MAP,
  EXAMPLE_ALLOW_MAP,
  FIXTURE_ALLOW_MAP,
  WIRING_MODULES
} from '../scripts/check-boundaries.mjs';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'check-boundaries.mjs');

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
        path: 'src/audio/engine.ts',
        content
      }
    ]);
    expect(ordinary).toHaveLength(1);

    const wiring = findViolations([
      {
        package: 'browser',
        path: 'src/session.ts',
        content
      }
    ]);
    expect(wiring).toHaveLength(0);

    const arbitraryPath = findViolations([
      {
        package: 'browser',
        path: 'anywhere/at/all/session.ts',
        content
      }
    ]);
    expect(arbitraryPath).toHaveLength(0);
  });

  // The umbrella is the one unit that reaches both concrete runtimes, each from
  // the facade module that re-exports it.
  it('confines each concrete runtime to its own module in a facade unit', () => {
    const renderer = "export * from '@luna-estelar/gas-renderer';";
    const lyria = "export * from '@luna-estelar/gas-connector-lyria';";
    expect(
      findViolations([
        { package: 'gas', path: 'src/renderer.ts', content: renderer },
        { package: 'gas', path: 'src/lyria.ts', content: lyria }
      ])
    ).toHaveLength(0);
    expect(findViolations([{ package: 'gas', path: 'src/index.ts', content: lyria }])).toHaveLength(
      1
    );
  });

  it('forbids every workspace unit from importing the umbrella package', () => {
    const violations = findViolations([
      {
        package: 'api',
        path: 'src/index.ts',
        content: "import { version } from '@luna-estelar/gas';"
      },
      {
        package: 'browser',
        path: 'src/session.ts',
        content: "import { createSession } from '@luna-estelar/gas/api';"
      },
      { package: 'examples', path: 'support.ts', content: "import '@luna-estelar/gas/core';" }
    ]);
    expect(
      violations.map((violation: { importedPackage: string }) => violation.importedPackage)
    ).toEqual(['@luna-estelar/gas', '@luna-estelar/gas', '@luna-estelar/gas']);
  });

  // Exercise scanner configuration independently of the packages present in this checkout.
  it('allows a unit the packages its allow map names', () => {
    const violations = findViolations(
      [
        {
          package: 'site',
          path: 'site/src/islands/TimelinePreview.tsx',
          content: "import { deriveTimeline } from '@luna-estelar/gas-browser/timeline';"
        }
      ],
      { site: ['browser'] }
    );
    expect(violations).toHaveLength(0);
  });

  // Astro frontmatter imports like any other module, so a page must not be able
  // to reach the concrete runtime just by not being a .ts file.
  it('holds the wiring rule for .astro pages too', () => {
    const page = findViolations([
      {
        package: 'browser',
        path: 'packages/browser/src/demo.astro',
        content: "import { createRenderer } from '@luna-estelar/gas-renderer';"
      }
    ]);
    expect(page).toHaveLength(1);
  });

  // Import text inside a rendered code sample is not an executable import.
  it('ignores a specifier inside a template literal', () => {
    const violations = findViolations([
      {
        package: 'browser',
        path: 'packages/browser/src/surfaces.astro',
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
        package: 'browser',
        path: 'packages/browser/src/playback-island.tsx',
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
        package: 'browser',
        path: 'packages/browser/src/player.astro',
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
        package: 'browser',
        path: 'packages/browser/src/player.jsx',
        content: "import { createRenderer } from '@luna-estelar/gas-renderer';"
      }
    ]);
    expect(component).toHaveLength(1);
  });

  // support.ts is imported by every package's corpus sweep. A GAS import here
  // would reach into all of them at once, including packages that may not
  // depend on what it pulled in.
  it('denies the shared example fixtures every GAS package', () => {
    const violations = findViolations([
      {
        package: 'examples',
        path: 'examples/support.ts',
        content: "import { compileSource } from '@luna-estelar/gas-language';"
      }
    ]);
    expect(violations).toHaveLength(1);
  });

  it('finds no violations in the real workspace tree', async () => {
    expect(findViolations(await collectAll())).toEqual([]);
  });

  it('covers every declared unit in the real workspace tree', async () => {
    const counts = await assertCoverage(await collectAll());
    expect(counts.filter(({ count }) => count === 0).map(({ unit }) => unit)).toEqual([]);
  });
});

// The exported helpers cannot tell whether main() ever runs, so a guard that
// never fires leaves `pnpm check:boundaries` silent and green. These cases
// assert the summary line the script prints only after a real scan.
describe('check-boundaries as a program', () => {
  const SUMMARY = /^Import boundaries OK: scanned [1-9]\d* files \(/;
  let scratch: string | undefined;

  afterAll(() => {
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  });

  function writeSource(file: string): void {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'export {};\n', 'utf8');
  }

  it('prints the scan summary for the real workspace', async () => {
    const { stdout } = await run(process.execPath, [script], { cwd: root });
    expect(stdout).toMatch(SUMMARY);
  });

  // The guard compared import.meta.url, which percent-encodes, against a raw
  // `file://${argv[1]}`. Under a path holding a space the two never matched, and
  // the check reported success without scanning a single file.
  it('prints the scan summary under a path containing a space', async () => {
    // Canonical, because Node resolves import.meta.url through symlinks while
    // argv[1] keeps the spelling it was given: on macOS the temporary directory
    // is itself a symlink, which would mask the case under test.
    scratch = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gas-boundaries-')));
    const tree = path.join(scratch, 'check out');
    const copy = path.join(tree, 'scripts', 'check-boundaries.mjs');
    mkdirSync(path.dirname(copy), { recursive: true });
    copyFileSync(script, copy);
    // The script imports TypeScript to read import statements, so the fixture
    // needs the dependencies a real checkout has.
    symlinkSync(path.join(root, 'node_modules'), path.join(tree, 'node_modules'), 'dir');

    // The script takes its root from its own location, so it scans this fixture.
    // Building the fixture from the script's own maps keeps it correct when a
    // later phase adds a unit or renames a wiring module. It does mirror
    // assertCoverage's requirements, so a new rule there surfaces here first.
    for (const unit of Object.keys(ALLOW_MAP)) {
      writeSource(path.join(tree, 'packages', unit, 'src', 'index.ts'));
    }
    for (const [unit, modules] of Object.entries(WIRING_MODULES)) {
      for (const wiringModule of [modules].flat() as string[]) {
        writeSource(path.join(tree, 'packages', unit, 'src', wiringModule));
      }
    }
    for (const unit of Object.keys(EXAMPLE_ALLOW_MAP)) {
      // Loose files directly under examples/ make up the shared-fixture unit.
      writeSource(
        unit === 'examples'
          ? path.join(tree, 'examples', 'support.ts')
          : path.join(tree, 'examples', unit, 'index.ts')
      );
    }
    // test/support/ is a required scan root, so it must exist in the fixture too.
    for (const _unit of Object.keys(FIXTURE_ALLOW_MAP)) {
      writeSource(path.join(tree, 'test', 'support', 'fixture.ts'));
    }

    const { stdout } = await run(process.execPath, [copy], { cwd: tree });
    expect(stdout).toMatch(SUMMARY);
  });
});
