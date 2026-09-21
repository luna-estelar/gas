import { execFileSync } from 'node:child_process';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';

export async function formatFiles(root, { write = false, report = console.log } = {}) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' }
  );
  const files = [...new Set(output.split('\0').filter(Boolean))].sort();
  const changed = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    try {
      if (!(await lstat(absolute)).isFile()) continue;
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const info = await prettier.getFileInfo(absolute, {
      ignorePath: path.join(root, '.prettierignore')
    });
    if (info.ignored || info.inferredParser === null) continue;
    const options = { ...(await prettier.resolveConfig(absolute)), filepath: absolute };
    const source = await readFile(absolute, 'utf8');
    const formatted = await prettier.format(source, options);
    if (formatted === source) continue;
    changed.push(file);
    if (write) await writeFile(absolute, formatted);
    report(file);
  }
  return { ok: write || changed.length === 0, changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check', '--write'].includes(args[0])) {
    console.error('Usage: node scripts/format.mjs --check|--write');
    process.exitCode = 1;
  } else {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = await formatFiles(root, { write: args[0] === '--write' });
    if (!result.ok) process.exitCode = 1;
    console.log(result.ok ? 'Formatting passed.' : 'Run pnpm format to fix formatting.');
  }
}
