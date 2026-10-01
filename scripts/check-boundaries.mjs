// Enforce package import boundaries. Exported scanner helpers are tested independently.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// Allowed GAS dependencies by package name.
export const ALLOW_MAP = {
  protocol: [],
  language: ['protocol'],
  highlight: [],
  notation: ['protocol'],
  api: ['protocol', 'language', 'core'],
  core: ['protocol'],
  renderer: ['protocol', 'core', 'notation'],
  'connector-lyria': ['protocol'],
  cli: ['language'],
  browser: ['protocol', 'language', 'core', 'api', 'renderer'],
  gas: [
    'protocol',
    'language',
    'core',
    'api',
    'renderer',
    'notation',
    'highlight',
    'connector-lyria',
    'cli',
    'browser'
  ]
};

// Fixture helpers must not import GAS packages: package tests share these helpers.
export const EXAMPLE_ALLOW_MAP = {
  examples: []
};

// Test fixtures under test/support/ are shared by several packages' test suites,
// so they must stay independent of every implementation they are used to test:
// Protocol only, which is types and the error class. A fixture that reached for
// the renderer or a connector would quietly couple one package's tests to
// another's implementation.
export const FIXTURE_ALLOW_MAP = {
  fixtures: ['protocol']
};

const CONCRETE_RUNTIME = new Set(['renderer', 'connector-lyria']);

/**
 * Runtime composition modules, keyed by package: the only files in that package
 * that may import a concrete runtime. A facade that re-exports several of them
 * lists one module per runtime.
 */
export const WIRING_MODULES = { browser: 'session.ts', gas: ['renderer.ts', 'lyria.ts'] };

// Units allowed to contain no scannable source files.
const EXPECTED_EMPTY = new Set();

const SPEC_PREFIX = '@luna-estelar/gas-';

// The umbrella package. It sits above every package, so nothing in the
// workspace may import it; it would otherwise slip past SPEC_PREFIX unchecked.
const UMBRELLA = '@luna-estelar/gas';
const UMBRELLA_UNIT = 'gas';

function wiringModulesOf(unit) {
  const modules = WIRING_MODULES[unit];
  if (modules === undefined) return undefined;
  return Array.isArray(modules) ? modules : [modules];
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Supported module file types, including JSX and Astro frontmatter.
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.jsx', '.astro'];

/**
 * Module specifiers imported by one block of TypeScript or JSX, read from the
 * syntax tree. The tree is what makes a specifier inside a comment, a string or
 * a template literal invisible: those are not import nodes, so a documentation
 * sample cannot be mistaken for an import. Type-only imports are reported like
 * any other, because the boundary rules govern what a package may name at all,
 * not only what it pulls in at runtime.
 */
function specifiersIn(text, scriptKind) {
  const source = ts.createSourceFile('scan.ts', text, ts.ScriptTarget.Latest, true, scriptKind);
  const specifiers = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/**
 * The spans of an `.astro` file that are module code: the frontmatter fence and
 * each `<script>` block. The markup between them is prose and is not scanned —
 * an import written there is documentation, not a dependency.
 */
function astroRegions(content) {
  const regions = [];
  const fence = /^\uFEFF?[ \t]*---[^\n]*\n/.exec(content);
  if (fence) {
    const start = fence[0].length;
    const close = /\r?\n[ \t]*---/.exec(content.slice(start));
    if (close) regions.push([start, start + close.index + 1]);
  }
  const openTag = /<script\b[^>]*>/gi;
  let match;
  while ((match = openTag.exec(content)) !== null) {
    const start = match.index + match[0].length;
    const close = /<\/script\s*>/i.exec(content.slice(start));
    if (!close) break;
    // A `<script>` quoted inside the frontmatter is already covered by it.
    if (regions.every(([from, to]) => start < from || start >= to)) {
      regions.push([start, start + close.index]);
    }
    openTag.lastIndex = start + close.index;
  }
  return regions;
}

/** Extract module specifiers from import/export/dynamic-import statements. */
export function extractSpecifiers(content, filePath = '') {
  if (filePath.endsWith('.astro')) {
    const regions = astroRegions(content);
    // Finding no module code is not the same as there being none: a fence this
    // did not recognize would otherwise skip the file silently, and a scan that
    // reads nothing passes every rule. So fall back to the whole file, which can
    // only over-report, never under-report.
    if (regions.length === 0) return specifiersIn(content, ts.ScriptKind.TS);
    return regions.flatMap(([start, end]) =>
      specifiersIn(content.slice(start, end), ts.ScriptKind.TS)
    );
  }
  const jsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
  return specifiersIn(content, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/**
 * @param files Array of { package, path, content }.
 * @param allowMap Per-unit allowed short names (defaults to every allow map).
 * @returns Array of violations.
 */
export function findViolations(
  files,
  allowMap = { ...ALLOW_MAP, ...EXAMPLE_ALLOW_MAP, ...FIXTURE_ALLOW_MAP }
) {
  const violations = [];
  for (const file of files) {
    const allowed = allowMap[file.package] ?? [];
    for (const specifier of extractSpecifiers(file.content, file.path)) {
      if (specifier === UMBRELLA || specifier.startsWith(`${UMBRELLA}/`)) {
        if (file.package !== UMBRELLA_UNIT) {
          violations.push({
            package: file.package,
            path: file.path,
            importedPackage: UMBRELLA,
            specifier
          });
        }
        continue;
      }
      if (!specifier.startsWith(SPEC_PREFIX)) continue;
      const importedShort = specifier.slice(SPEC_PREFIX.length).split('/')[0];
      if (importedShort === file.package) continue; // self-import is fine
      const confinedTo = wiringModulesOf(file.package);
      if (
        confinedTo !== undefined &&
        CONCRETE_RUNTIME.has(importedShort) &&
        !confinedTo.includes(path.basename(file.path))
      ) {
        violations.push({
          package: file.package,
          path: file.path,
          importedPackage: `${SPEC_PREFIX}${importedShort}`,
          specifier
        });
        continue;
      }
      if (!allowed.includes(importedShort)) {
        violations.push({
          package: file.package,
          path: file.path,
          importedPackage: `${SPEC_PREFIX}${importedShort}`,
          specifier
        });
      }
    }
  }
  return violations;
}

// `required` is for a scan root that must exist: a missing one has to fail
// rather than contribute nothing, because a scan of nothing passes every rule.
// Optional subdirectories (a package without tests) keep the quiet behaviour.
async function walkSource(dir, { required = false } = {}) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (required) throw error;
    return found; // directory may not exist (e.g. a package without tests)
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkSource(full)));
    } else if (entry.isFile() && SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

export async function collectWorkspaceFiles(packagesRoot) {
  const files = [];
  const packages = (await readdir(packagesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const pkg of packages) {
    for (const sub of ['src', 'test']) {
      for (const filePath of await walkSource(path.join(packagesRoot, pkg, sub))) {
        files.push({ package: pkg, path: filePath, content: await readFile(filePath, 'utf8') });
      }
    }
  }
  return files;
}

/** Collect example modules by their immediate subdirectory, or the root examples unit. */
export async function collectExampleFiles(examplesRoot) {
  const files = [];
  // A missing scan root must fail; only optional package subdirectories may be absent.
  const entries = await readdir(examplesRoot, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(examplesRoot, entry.name);
    if (entry.isDirectory()) {
      for (const filePath of await walkSource(full)) {
        files.push({
          package: entry.name,
          path: filePath,
          content: await readFile(filePath, 'utf8')
        });
      }
    } else if (entry.isFile() && SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push({ package: 'examples', path: full, content: await readFile(full, 'utf8') });
    }
  }
  return files;
}

/** Collect the test fixtures shared across package test suites. */
export async function collectFixtureFiles(fixturesRoot) {
  const files = [];
  // A missing scan root must fail, like the examples root: silently scanning
  // nothing is what makes a boundary check green and worthless.
  for (const filePath of await walkSource(fixturesRoot, { required: true })) {
    files.push({
      package: 'fixtures',
      path: filePath,
      content: await readFile(filePath, 'utf8')
    });
  }
  return files;
}

/** Collect every source file governed by the boundary scanner. */
export async function collectAll(root = ROOT) {
  return [
    ...(await collectWorkspaceFiles(path.join(root, 'packages'))),
    ...(await collectExampleFiles(path.join(root, 'examples'))),
    ...(await collectFixtureFiles(path.join(root, 'test', 'support')))
  ];
}

async function collectUnitDirectories(root) {
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Verify that the configured boundary units and the files found on disk cover
 * one another. Returns sorted per-unit file counts for reporting.
 */
export async function assertCoverage(files, root = ROOT) {
  const packageDirectories = await collectUnitDirectories(path.join(root, 'packages'));
  const exampleDirectories = await collectUnitDirectories(path.join(root, 'examples'));
  const errors = [];

  for (const unit of Object.keys(ALLOW_MAP)) {
    if (!packageDirectories.includes(unit)) {
      errors.push(`declared but missing package unit: ${unit}`);
    }
  }
  for (const unit of packageDirectories) {
    if (!(unit in ALLOW_MAP)) errors.push(`undeclared unit: packages/${unit}`);
  }
  for (const unit of Object.keys(EXAMPLE_ALLOW_MAP)) {
    if (unit !== 'examples' && !exampleDirectories.includes(unit)) {
      errors.push(`declared but missing example unit: ${unit}`);
    }
  }
  // Require a boundary declaration once an example directory contains source code.
  for (const unit of exampleDirectories) {
    if (unit in EXAMPLE_ALLOW_MAP) continue;
    if (files.some((file) => file.package === unit)) {
      errors.push(`undeclared unit: examples/${unit}`);
    }
  }

  const allowMap = { ...ALLOW_MAP, ...EXAMPLE_ALLOW_MAP, ...FIXTURE_ALLOW_MAP };
  for (const [unit, allowed] of Object.entries(allowMap)) {
    if (allowed.some((dependency) => CONCRETE_RUNTIME.has(dependency))) {
      if (WIRING_MODULES[unit] === undefined) {
        errors.push(`unit allowed concrete runtime imports has no wiring module: ${unit}`);
      }
    }
  }

  for (const unit of Object.keys(WIRING_MODULES)) {
    for (const wiringModule of wiringModulesOf(unit)) {
      const matched = files.some(
        (file) => file.package === unit && path.basename(file.path) === wiringModule
      );
      if (!matched) errors.push(`wiring module matched no scanned file: ${unit}/${wiringModule}`);
    }
  }

  const counts = Object.keys(allowMap)
    .sort()
    .map((unit) => ({
      unit,
      count: files.filter((file) => file.package === unit).length
    }));
  for (const { unit, count } of counts) {
    if (count === 0 && !EXPECTED_EMPTY.has(unit)) {
      errors.push(`declared unit contributed no scanned files: ${unit}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Boundary scan coverage failed:\n  ${errors.join('\n  ')}`);
  }
  return counts;
}

async function main() {
  const files = await collectAll(ROOT);
  const counts = await assertCoverage(files, ROOT);
  const violations = findViolations(files);
  if (violations.length > 0) {
    console.error('Import-boundary violations found:');
    for (const v of violations) {
      console.error(
        `  ${path.relative(ROOT, v.path)}: '${v.package}' may not import ${v.importedPackage}`
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `Import boundaries OK: scanned ${files.length} files ` +
      `(${counts.map(({ unit, count }) => `${unit}: ${count}`).join(', ')}).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
