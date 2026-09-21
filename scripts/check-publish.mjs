// Validate packed manifests with publint and declaration resolution with attw.
// Build first. Packages are ESM-only, so cjs-resolves-to-esm is excluded.
// The node16 profile excludes legacy node10 resolution; schema wildcard exports
// are reported without static entrypoint analysis.
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.join(root, 'packages');

async function publishablePackages() {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packagesRoot, entry.name);
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    if (manifest.private === true) continue;
    found.push({ name: manifest.name, dir });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

async function check(tool, args, dir) {
  try {
    await run(path.join(root, 'node_modules', '.bin', tool), args, { cwd: root });
    return undefined;
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    return output === '' ? `${tool} failed in ${dir}` : output;
  }
}

const packages = await publishablePackages();
if (packages.length === 0) {
  console.error('check:publish found no publishable packages — that is itself a failure.');
  process.exit(1);
}

let failed = 0;
for (const { name, dir } of packages) {
  const relative = path.relative(root, dir);
  const problems = [
    await check('publint', ['--strict', relative], relative),
    await check(
      'attw',
      ['--pack', relative, '--profile', 'node16', '--ignore-rules', 'cjs-resolves-to-esm'],
      relative
    )
  ].filter((problem) => problem !== undefined);

  if (problems.length === 0) {
    console.log(`  ok  ${name}`);
    continue;
  }
  failed++;
  console.error(`FAIL  ${name}`);
  for (const problem of problems) console.error(problem);
}

if (failed > 0) {
  console.error(`\ncheck:publish: ${failed} of ${packages.length} packages would publish broken.`);
  process.exit(1);
}
console.log(`\ncheck:publish: ${packages.length} packages are publishable.`);
