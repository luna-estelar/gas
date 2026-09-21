import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { formatFiles } from '../scripts/format.mjs';

const roots: string[] = [];
function git(root: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gas-format-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(path.join(root, '.prettierignore'), 'generated/\n');
  writeFileSync(path.join(root, 'tracked.ts'), 'export const value = 1;\n');
  git(root, 'add', '.prettierignore', 'tracked.ts');
  git(root, 'commit', '-qm', 'Initialize fixture');
  return root;
}
const options = { report: () => {} };
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('repository formatting', () => {
  test('ignores local configuration and generated files', async () => {
    const root = fixture();
    mkdirSync(path.join(root, '.local'));
    mkdirSync(path.join(root, 'generated'));
    writeFileSync(path.join(root, '.git', 'info', 'exclude'), '.local/\n');
    writeFileSync(path.join(root, '.local', 'settings.json'), 'invalid json');
    writeFileSync(path.join(root, 'generated', 'output.ts'), 'invalid typescript');
    expect((await formatFiles(root, options)).ok).toBe(true);
  });

  test('checks and formats untracked source with spaces in its filename', async () => {
    const root = fixture();
    const file = path.join(root, 'new source.ts');
    writeFileSync(file, 'export const value=2');
    expect(await formatFiles(root, options)).toEqual({ ok: false, changed: ['new source.ts'] });
    expect(readFileSync(file, 'utf8')).toBe('export const value=2');
    expect((await formatFiles(root, { ...options, write: true })).ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('export const value = 2;\n');
    expect((await formatFiles(root, options)).ok).toBe(true);
  });

  test('skips staged deletions, missing tracked files and unsupported formats', async () => {
    const root = fixture();
    writeFileSync(path.join(root, 'missing.ts'), 'export const value = 2;\n');
    git(root, 'add', 'missing.ts');
    rmSync(path.join(root, 'missing.ts'));
    git(root, 'rm', 'tracked.ts');
    writeFileSync(path.join(root, 'sample.bin'), Buffer.from([0, 255, 1]));
    expect((await formatFiles(root, options)).ok).toBe(true);
  });

  test('respects local excludes in a linked worktree', async () => {
    const root = fixture();
    const parent = mkdtempSync(path.join(os.tmpdir(), 'gas-linked-format-'));
    roots.push(parent);
    const linked = path.join(parent, 'checkout');
    git(root, 'worktree', 'add', '--detach', linked, 'HEAD');
    writeFileSync(path.join(root, '.git', 'info', 'exclude'), 'local-settings.json\n');
    writeFileSync(path.join(linked, 'local-settings.json'), 'invalid json');
    expect((await formatFiles(linked, options)).ok).toBe(true);
  });
});
