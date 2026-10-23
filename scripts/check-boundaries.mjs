// Enforce module boundaries inside packages/gas, plus the lyria, fixture and
// example units. Modules import each other by relative path, so a specifier is
// resolved to the directory it lands in and checked against that module's list.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// Modules each module may import, keyed by directory under packages/gas/src.
// Every module may also import the version leaf.
export const ALLOW_MAP = {
  protocol: [],
  language: ['protocol'],
  highlight: [],
  notation: ['protocol'],
  core: ['protocol'],
  api: ['protocol', 'language', 'core'],
  renderer: ['protocol', 'core', 'notation'],
  cli: ['language'],
  editor: ['protocol', 'language'],
  browser: ['protocol', 'core', 'api', 'renderer']
};

// The entry files behind the export map, and the modules each re-exports.
export const FACADES = {
  'index.ts': ['api', 'renderer', 'version'],
  'language.ts': ['language', 'editor'],
  'browser.ts': ['browser'],
  'protocol.ts': ['protocol'],
  'protocol-validation.ts': ['protocol'],
  'highlight.ts': ['highlight']
};

// The version literal: a leaf every module may import, which imports nothing.
const VERSION_FILE = 'version.ts';
const VERSION_UNIT = 'version';

// Test fixtures under test/support/ are shared by several modules' test suites,
// so they must stay independent of every implementation they are used to test:
// Protocol only, which is types and the error class. A fixture that reached for
// the renderer would quietly couple one module's tests to another's code.
const FIXTURE_ALLOW = ['protocol'];

// The renderer is the concrete runtime. Only these files outside it may import
// it: the browser session wires it up, and the root entry re-exports it.
const RUNTIME_MODULE = 'renderer';
const RUNTIME_WIRING = ['browser/session.ts', 'index.ts'];

// The only package specifier lyria-rt may use: it peers on gas for the protocol.
const LYRIA_ALLOWED = ['@luna-estelar/gas/protocol'];

const PACKAGE_UNITS = ['gas', 'lyria-rt'];

// Units that are not modules. A module directory with one of these names would
// share its permissions, so it is rejected.
const RESERVED_UNITS = [VERSION_UNIT, 'lyria-rt', 'fixtures', 'examples'];

// Export-map keys that load assets rather than code, with their exact targets.
const ASSET_EXPORTS = { './protocol/schemas/1.0/*': './schemas/1.0/*' };
const SCOPE = '@luna-estelar/';

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

const facadeUnit = (file) => `facade ${file}`;

/**
 * Where a relative specifier lands inside packages/gas/src: a module name, the
 * version unit, or a facade. Undefined when it leaves src (generated output,
 * schemas, shared test support), which is not a module edge.
 */
export function targetOf(fromFile, specifier, srcRoot) {
  if (!specifier.startsWith('.')) return undefined;
  const target = path.resolve(path.dirname(fromFile), specifier);
  const relative = path.relative(srcRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  const segments = relative.split(path.sep);
  if (segments.length > 1)
    return { unit: segments[0], file: segments.slice(1).join('/').replace(/\.js$/, '.ts') };
  if (segments[0].startsWith('version.')) return { unit: VERSION_UNIT };
  return { unit: facadeUnit(segments[0].replace(/\.js$/, '.ts')), facade: true };
}

function allowedFor(file) {
  if (file.unit === VERSION_UNIT) return [];
  if (file.facade !== undefined) return FACADES[file.facade] ?? [];
  if (file.unit === 'fixtures') return FIXTURE_ALLOW;
  if (file.unit in ALLOW_MAP) return [...ALLOW_MAP[file.unit], VERSION_UNIT];
  return [];
}

/**
 * @param files Array of { unit, path, content, facade?, wiring? }.
 * @param srcRoot packages/gas/src, against which relative specifiers resolve.
 * @returns Array of violations.
 */
export function findViolations(files, srcRoot = path.join(ROOT, 'packages', 'gas', 'src')) {
  const violations = [];
  const report = (file, target, specifier) =>
    violations.push({ unit: file.unit, path: file.path, target, specifier });

  for (const file of files) {
    const allowed = allowedFor(file);
    for (const specifier of extractSpecifiers(file.content, file.path)) {
      if (file.unit === VERSION_UNIT) {
        // The leaf every module may import depends on nothing, packages included.
        report(file, specifier, specifier);
        continue;
      }
      if (specifier.startsWith(SCOPE)) {
        // Inside gas nothing imports a package by name, itself included.
        if (file.unit === 'lyria-rt' && LYRIA_ALLOWED.includes(specifier)) continue;
        report(file, specifier, specifier);
        continue;
      }
      const target = targetOf(file.path, specifier, srcRoot);
      if (target === undefined || target.unit === file.unit) continue;
      if (target.facade) {
        // Facades are entry points for consumers, never a dependency.
        report(file, target.unit, specifier);
        continue;
      }
      if (!allowed.includes(target.unit)) {
        report(file, target.unit, specifier);
        continue;
      }
      if (file.facade === 'protocol-validation.ts' && target.file !== 'validation.ts') {
        report(file, `${target.unit}/${target.file}`, specifier);
        continue;
      }
      if (target.unit === RUNTIME_MODULE && !RUNTIME_WIRING.includes(file.wiring)) {
        report(file, target.unit, specifier);
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

async function readFiles(paths, fields) {
  return Promise.all(
    paths.map(async (filePath) => ({
      ...fields(filePath),
      path: filePath,
      content: await readFile(filePath, 'utf8')
    }))
  );
}

/** Collect packages/gas: module sources and tests, facades and the version leaf. */
export async function collectGasFiles(gasRoot) {
  const srcRoot = path.join(gasRoot, 'src');
  const files = [];
  for (const entry of await readdir(srcRoot, { withFileTypes: true })) {
    const full = path.join(srcRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await readFiles(await walkSource(full), (filePath) => ({
          unit: entry.name,
          wiring: path.relative(srcRoot, filePath).split(path.sep).join('/')
        })))
      );
    } else if (entry.isFile() && entry.name === VERSION_FILE) {
      files.push(...(await readFiles([full], () => ({ unit: VERSION_UNIT }))));
    } else if (entry.isFile() && SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(
        ...(await readFiles([full], () => ({
          unit: facadeUnit(entry.name),
          facade: entry.name,
          wiring: entry.name
        })))
      );
    }
  }
  // A module's tests follow that module's boundary.
  const testRoot = path.join(gasRoot, 'test');
  for (const entry of await readdir(testRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    files.push(
      ...(await readFiles(await walkSource(path.join(testRoot, entry.name)), () => ({
        unit: entry.name,
        testDirectory: entry.name
      })))
    );
  }
  return files;
}

/** Collect the lyria-rt package's sources and tests. */
export async function collectLyriaFiles(lyriaRoot) {
  const paths = [
    ...(await walkSource(path.join(lyriaRoot, 'src'), { required: true })),
    ...(await walkSource(path.join(lyriaRoot, 'test')))
  ];
  return readFiles(paths, () => ({ unit: 'lyria-rt' }));
}

/**
 * Collect every example module as the one examples unit, subdirectories
 * included: naming a unit after a subdirectory would let examples/browser/
 * inherit the browser module's permissions.
 */
export async function collectExampleFiles(examplesRoot) {
  // A missing scan root must fail, like the fixtures root.
  return readFiles(await walkSource(examplesRoot, { required: true }), () => ({
    unit: 'examples'
  }));
}

/** Collect the test fixtures shared across module test suites. */
export async function collectFixtureFiles(fixturesRoot) {
  const files = [];
  // A missing scan root must fail, like the examples root: silently scanning
  // nothing is what makes a boundary check green and worthless.
  for (const filePath of await walkSource(fixturesRoot, { required: true })) {
    files.push({
      unit: 'fixtures',
      path: filePath,
      content: await readFile(filePath, 'utf8')
    });
  }
  return files;
}

/** Collect every source file governed by the boundary scanner. */
export async function collectAll(root = ROOT) {
  const packagesRoot = path.join(root, 'packages');
  return [
    ...(await collectGasFiles(path.join(packagesRoot, 'gas'))),
    ...(await collectLyriaFiles(path.join(packagesRoot, 'lyria-rt'))),
    ...(await collectExampleFiles(path.join(root, 'examples'))),
    ...(await collectFixtureFiles(path.join(root, 'test', 'support')))
  ];
}

async function directoriesIn(root) {
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Every path an export-map target can resolve to, through nested conditions. */
function leafTargets(target) {
  if (typeof target === 'string') return [target];
  if (target === null || typeof target !== 'object') return [String(target)];
  return Object.values(target).flatMap(leafTargets);
}

/** Errors when the two sets differ, naming what each side lacks. */
function compareSets(errors, declared, found, declaredLabel, foundLabel) {
  for (const name of declared) {
    if (!found.includes(name)) errors.push(`${declaredLabel} but not ${foundLabel}: ${name}`);
  }
  for (const name of found) {
    if (!declared.includes(name)) errors.push(`${foundLabel} but not ${declaredLabel}: ${name}`);
  }
}

/**
 * Verify that the configured units, the files on disk and the export map cover
 * one another. Returns sorted per-unit file counts for reporting.
 */
export async function assertCoverage(files, root = ROOT) {
  const errors = [];
  const gasRoot = path.join(root, 'packages', 'gas');
  const srcRoot = path.join(gasRoot, 'src');

  compareSets(
    errors,
    PACKAGE_UNITS,
    await directoriesIn(path.join(root, 'packages')),
    'declared package',
    'directory under packages/'
  );

  const modules = Object.keys(ALLOW_MAP).sort();
  for (const name of RESERVED_UNITS) {
    if (modules.includes(name)) errors.push(`module name is reserved for another unit: ${name}`);
  }
  compareSets(
    errors,
    modules,
    await directoriesIn(srcRoot),
    'declared module',
    'directory under src/'
  );
  for (const directory of await directoriesIn(path.join(gasRoot, 'test'))) {
    if (!modules.includes(directory))
      errors.push(`test directory is not a module: test/${directory}`);
  }

  const facadeFiles = (await readdir(srcRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== VERSION_FILE)
    .map((entry) => entry.name)
    .sort();
  compareSets(errors, Object.keys(FACADES).sort(), facadeFiles, 'declared facade', 'file in src/');

  // Each facade is what one export-map key loads, and each key loads a facade.
  // Only the declared asset keys are exempt, and only with their exact targets.
  const manifest = JSON.parse(await readFile(path.join(gasRoot, 'package.json'), 'utf8'));
  const exported = [];
  for (const [key, target] of Object.entries(manifest.exports)) {
    if (key in ASSET_EXPORTS) {
      if (target !== ASSET_EXPORTS[key]) {
        errors.push(`asset export ${key} must map to ${ASSET_EXPORTS[key]}`);
      }
      continue;
    }
    const leaves = leafTargets(target);
    const strays = leaves.filter((leaf) => !/^\.\/out\/[^/]+\.(?:js|d\.ts)$/.test(leaf));
    if (strays.length > 0) {
      errors.push(`export ${key} loads a path that is not a facade: ${strays.join(', ')}`);
      continue;
    }
    const names = new Set(leaves.map((leaf) => path.basename(leaf).replace(/\.(?:js|d\.ts)$/, '')));
    if (names.size !== 1) {
      errors.push(`export ${key} must load one facade: ${[...names].join(', ')}`);
      continue;
    }
    exported.push(`${[...names][0]}.ts`);
  }
  exported.sort();
  compareSets(
    errors,
    Object.keys(FACADES).sort(),
    exported,
    'declared facade',
    'export-map target'
  );

  for (const wiring of RUNTIME_WIRING) {
    if (!files.some((file) => file.wiring === wiring && file.testDirectory === undefined)) {
      errors.push(`runtime wiring file matched no scanned file: src/${wiring}`);
    }
  }

  const units = [
    ...modules,
    ...Object.keys(FACADES).map(facadeUnit),
    VERSION_UNIT,
    'lyria-rt',
    'fixtures',
    'examples'
  ];
  const counts = units.map((unit) => ({
    unit,
    count: files.filter((file) => file.unit === unit).length
  }));
  for (const { unit, count } of counts) {
    if (count === 0) errors.push(`declared unit contributed no scanned files: ${unit}`);
  }
  for (const file of files) {
    if (!units.includes(file.unit)) errors.push(`undeclared unit: ${file.unit} (${file.path})`);
  }

  if (errors.length > 0) {
    throw new Error(`Boundary scan coverage failed:\n  ${[...new Set(errors)].join('\n  ')}`);
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
      console.error(`  ${path.relative(ROOT, v.path)}: '${v.unit}' may not import ${v.target}`);
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
