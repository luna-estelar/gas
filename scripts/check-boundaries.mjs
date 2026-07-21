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

export const APP_ALLOW_MAP = {};

const SPEC_PREFIX = '@luna-estelar/gas-';

/** Extract module specifiers from import/export/dynamic-import statements. */
export function extractSpecifiers(content) {
  const specifiers = [];
  const patterns = [
    /(?:^|[\s;])(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, // import/export ... from '...'
    /(?:^|[\s;])import\s*['"]([^'"]+)['"]/g, // side-effect import '...'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g // dynamic import('...')
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * @param files Array of { package, path, content }.
 * @param allowMap Per-package allowed short names (defaults to ALLOW_MAP).
 * @returns Array of violations.
 */
export function findViolations(files, allowMap = ALLOW_MAP) {
  const violations = [];
  for (const file of files) {
    const allowed = allowMap[file.package] ?? [];
    for (const specifier of extractSpecifiers(file.content)) {
      if (!specifier.startsWith(SPEC_PREFIX)) continue;
      const importedShort = specifier.slice(SPEC_PREFIX.length).split('/')[0];
      if (importedShort === file.package) continue; // self-import is fine
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

async function walkTs(dir) {
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
      found.push(...(await walkTs(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

async function collectWorkspaceFiles(packagesRoot) {
  const files = [];
  const packages = (await readdir(packagesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const pkg of packages) {
    for (const sub of ['src', 'test']) {
      for (const filePath of await walkTs(path.join(packagesRoot, pkg, sub))) {
        files.push({ package: pkg, path: filePath, content: await readFile(filePath, 'utf8') });
      }
    }
  }
  return files;
}

async function collectProjectFiles(projectRoot, projectName) {
  const files = [];
  for (const sub of ['src', 'test']) {
    for (const filePath of await walkTs(path.join(projectRoot, sub))) {
      files.push({
        package: projectName,
        path: filePath,
        content: await readFile(filePath, 'utf8')
      });
    }
  }
  return files;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const packageFiles = await collectWorkspaceFiles(path.join(root, 'packages'));
  const files = packageFiles;
  const violations = findViolations(files, { ...ALLOW_MAP, ...APP_ALLOW_MAP });
  if (violations.length > 0) {
    console.error('Import-boundary violations found:');
    for (const v of violations) {
      console.error(
        `  ${path.relative(root, v.path)}: '${v.package}' may not import ${v.importedPackage}`
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Import boundaries OK: scanned ${files.length} files across packages.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
