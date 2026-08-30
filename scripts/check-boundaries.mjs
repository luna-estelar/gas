// Enforce package import boundaries. Exported scanner helpers are tested independently.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Allowed GAS dependencies by package name.
export const ALLOW_MAP = {
  protocol: [],
  language: ['protocol'],
  notation: ['protocol'],
  api: ['protocol', 'language', 'core'],
  core: ['protocol'],
  renderer: ['protocol', 'core', 'notation'],
  'connector-lyria': ['protocol'],
  cli: ['protocol', 'language', 'core']
};

// Optional dependency rules for consuming applications.
export const APP_ALLOW_MAP = {};

const CONCRETE_RUNTIME = new Set(['renderer', 'connector-lyria']);

/** Runtime composition modules, keyed by package. */
export const WIRING_MODULES = {};

// Units with no source files.
const EXPECTED_EMPTY = new Set();

const SPEC_PREFIX = '@luna-estelar/gas-';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Scan TypeScript, JSX and Astro module code.
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.jsx', '.astro'];

// Replace string contents with indexed handles so code samples cannot match import patterns.
const HANDLE = /^@@literal:(\d+)@@$/;

// After one of these, a `/` opens a regex literal rather than dividing. Without
// the keyword list, `return /x['"]/` reads as division and its quotes open a
// phantom string.
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'case',
  'do',
  'else',
  'yield',
  'await',
  'delete',
  'void',
  'new'
]);

class MaskError extends Error {}

/**
 * Mask comments, regexes and template text; store quoted strings in a shared table.
 * Unclosed literals throw MaskError so callers can fall back to scanning raw text.
 * @param source Module text.
 * @param literals String contents indexed by generated handles.
 */
function maskCode(source, literals) {
  let out = '';
  let i = 0;
  let prev = ''; // last significant code character emitted
  let word = ''; // identifier ending at `prev`, for the regex-vs-division test
  const modes = ['code'];
  const substitutionDepths = []; // brace depth at each open `${`
  let braceDepth = 0;

  const blank = (text) => text.replace(/[^\n]/g, ' ');
  const advance = (char) => {
    if (/\s/.test(char)) return;
    word = /[\w$]/.test(char) ? word + char : '';
    prev = char;
  };

  while (i < source.length) {
    const char = source[i];

    if (modes[modes.length - 1] === 'template') {
      if (char === '\\') {
        out += blank(source.slice(i, i + 2));
        i += 2;
      } else if (char === '`') {
        out += ' ';
        i += 1;
        modes.pop();
        advance(')'); // a finished template is a value, so a following `/` divides
      } else if (char === '$' && source[i + 1] === '{') {
        out += '  ';
        i += 2;
        modes.push('code');
        substitutionDepths.push(braceDepth);
        braceDepth += 1;
        prev = '(';
        word = '';
      } else {
        out += char === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }

    if (char === '/' && source[i + 1] === '/') {
      const newline = source.indexOf('\n', i);
      const stop = newline === -1 ? source.length : newline;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new MaskError('unterminated block comment');
      out += blank(source.slice(i, end + 2));
      i = end + 2;
      continue;
    }
    // `prev === '<'` is a JSX closing tag, not a regex — the islands are .tsx.
    if (
      char === '/' &&
      prev !== '<' &&
      (!/[\w$)\]}]/.test(prev) || REGEX_PRECEDING_KEYWORDS.has(word))
    ) {
      const end = endOfRegex(source, i);
      out += blank(source.slice(i, end));
      i = end;
      advance(')');
      continue;
    }
    if (char === "'" || char === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== char) {
        if (source[j] === '\n') throw new MaskError('newline inside a quoted string');
        j += source[j] === '\\' ? 2 : 1;
      }
      if (j >= source.length) throw new MaskError('unterminated string');
      out += `'@@literal:${literals.length}@@'`;
      literals.push(source.slice(i + 1, j));
      i = j + 1;
      advance(')');
      continue;
    }
    if (char === '`') {
      out += ' ';
      i += 1;
      modes.push('template');
      continue;
    }
    if (char === '{') braceDepth += 1;
    if (char === '}') {
      braceDepth -= 1;
      if (modes.length > 1 && braceDepth === substitutionDepths[substitutionDepths.length - 1]) {
        substitutionDepths.pop();
        modes.pop();
        out += ' ';
        i += 1;
        continue;
      }
    }
    out += char;
    advance(char);
    i += 1;
  }

  if (modes.length > 1) throw new MaskError('unterminated template literal');
  return out;
}

/** Index just past the regex literal starting at `start`. */
function endOfRegex(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '\n') throw new MaskError('newline inside a regex literal');
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) return i + 1;
    i += 1;
  }
  throw new MaskError('unterminated regex literal');
}

// Scan Astro frontmatter and script blocks as module code; leave markup as text.
function maskAstro(content, literals) {
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
    regions.push([start, start + close.index]);
    openTag.lastIndex = start + close.index;
  }

  let out = '';
  let cursor = 0;
  for (const [start, end] of regions) {
    if (start < cursor) continue; // a `<script>` quoted inside the frontmatter
    out += content.slice(cursor, start);
    out += maskCode(content.slice(start, end), literals);
    cursor = end;
  }
  return out + content.slice(cursor);
}

/** Extract module specifiers from import/export/dynamic-import statements. */
export function extractSpecifiers(content, filePath = '') {
  const literals = [];
  let masked;
  try {
    masked = filePath.endsWith('.astro')
      ? maskAstro(content, literals)
      : maskCode(content, literals);
  } catch (error) {
    if (!(error instanceof MaskError)) throw error;
    masked = content; // lost the thread: scan the raw text, as this script always did
    literals.length = 0;
  }

  const specifiers = [];
  const patterns = [
    /(?:^|[\s;])(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, // import/export ... from '...'
    /(?:^|[\s;])import\s*['"]([^'"]+)['"]/g, // side-effect import '...'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g // dynamic import('...')
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(masked)) !== null) {
      const handle = HANDLE.exec(match[1]);
      specifiers.push(handle ? (literals[Number(handle[1])] ?? '') : match[1]);
    }
  }
  return specifiers;
}

/**
 * @param files Array of { package, path, content }.
 * @param allowMap Per-package allowed short names (defaults to ALLOW_MAP + APP_ALLOW_MAP).
 * @returns Array of violations.
 */
export function findViolations(files, allowMap = { ...ALLOW_MAP, ...APP_ALLOW_MAP }) {
  const violations = [];
  for (const file of files) {
    const allowed = allowMap[file.package] ?? [];
    for (const specifier of extractSpecifiers(file.content, file.path)) {
      if (!specifier.startsWith(SPEC_PREFIX)) continue;
      const importedShort = specifier.slice(SPEC_PREFIX.length).split('/')[0];
      if (importedShort === file.package) continue; // self-import is fine
      const confinedTo = WIRING_MODULES[file.package];
      if (
        confinedTo !== undefined &&
        CONCRETE_RUNTIME.has(importedShort) &&
        path.basename(file.path) !== confinedTo
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

async function walkSource(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
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

export async function collectApplicationFiles(appsRoot) {
  const files = [];
  const apps = (await readdir(appsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const app of apps) {
    for (const filePath of await walkSource(path.join(appsRoot, app, 'src'))) {
      files.push({
        package: app,
        path: filePath,
        content: await readFile(filePath, 'utf8')
      });
    }
  }
  return files;
}

/** Collect every source file governed by the boundary scanner. */
export async function collectAll(root = ROOT) {
  return [...(await collectWorkspaceFiles(path.join(root, 'packages')))];
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
  const applicationDirectories = [];
  const errors = [];

  for (const unit of Object.keys(ALLOW_MAP)) {
    if (!packageDirectories.includes(unit)) {
      errors.push(`declared but missing package unit: ${unit}`);
    }
  }
  for (const unit of Object.keys(APP_ALLOW_MAP)) {
    if (!applicationDirectories.includes(unit)) {
      errors.push(`declared but missing application unit: ${unit}`);
    }
  }
  for (const unit of packageDirectories) {
    if (!(unit in ALLOW_MAP)) errors.push(`undeclared unit: packages/${unit}`);
  }
  for (const unit of applicationDirectories) {
    if (!(unit in APP_ALLOW_MAP)) errors.push(`undeclared unit: apps/${unit}`);
  }

  const allowMap = { ...ALLOW_MAP, ...APP_ALLOW_MAP };
  for (const [unit, allowed] of Object.entries(allowMap)) {
    if (allowed.some((dependency) => CONCRETE_RUNTIME.has(dependency))) {
      if (WIRING_MODULES[unit] === undefined) {
        errors.push(`unit allowed concrete runtime imports has no wiring module: ${unit}`);
      }
    }
  }

  for (const [unit, wiringModule] of Object.entries(WIRING_MODULES)) {
    const matched = files.some(
      (file) => file.package === unit && path.basename(file.path) === wiringModule
    );
    if (!matched) errors.push(`wiring module matched no scanned file: ${unit}/${wiringModule}`);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
