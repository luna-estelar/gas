import { describe, expect, it } from 'vitest';
import { compileSource } from '@luna-estelar/gas-language';
import { execute, packageName, version, type CliIo } from '../src/index.js';
import { readExample } from '../../../examples/support.js';

function harness(files: Record<string, string> = {}): {
  io: CliIo;
  stdout: string[];
  stderr: string[];
  written: Map<string, string>;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const written = new Map<string, string>();
  return {
    stdout,
    stderr,
    written,
    io: {
      readFile(file) {
        if (!(file in files)) throw new Error('ENOENT');
        return files[file] ?? '';
      },
      writeFile(file, contents) {
        if (file === '/blocked') throw new Error('EACCES');
        written.set(file, contents);
      },
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value)
    }
  };
}

describe('@luna-estelar/gas-cli', () => {
  it('exposes package metadata', () => {
    expect(packageName).toBe('@luna-estelar/gas-cli');
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('preserves help and version output', () => {
    const help = harness();
    expect(execute(['--help'], help.io)).toBe(0);
    expect(help.stdout.join('')).toContain('gas compile <file>');

    const release = harness();
    expect(execute(['--version'], release.io)).toBe(0);
    expect(release.stdout).toEqual([`${version}\n`]);
  });

  it('compiles deterministically to stdout', () => {
    const source = readExample('spec-example');
    const cli = harness({ 'song.gas': source });
    expect(execute(['compile', 'song.gas'], cli.io)).toBe(0);
    const direct = compileSource(source, { name: 'song.gas' });
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    expect(cli.stdout).toEqual([`${JSON.stringify(direct.timeline, null, 2)}\n`]);
  });

  it('writes --out without timeline JSON on stdout', () => {
    const source = readExample('spec-example');
    const cli = harness({ 'song.gas': source });
    expect(execute(['compile', 'song.gas', '--out', 'timeline.json'], cli.io)).toBe(0);
    expect(cli.stdout).toEqual([]);
    expect(cli.written.get('timeline.json')).toMatch(/^\{\n/);
  });

  it('routes diagnostics to stderr and fails invalid source', () => {
    const cli = harness({ 'broken.gas': 'length bananas\n' });
    expect(execute(['compile', 'broken.gas'], cli.io)).toBe(1);
    expect(cli.stdout).toEqual([]);
    expect(cli.stderr.join('')).toMatch(/broken\.gas:\d+:\d+: error \[syntax\//);
  });

  it('reports argument, read, and write failures', () => {
    const missingArgs = harness();
    expect(execute(['compile'], missingArgs.io)).toBe(1);
    expect(missingArgs.stderr.join('')).toContain('requires a source file');

    const unknown = harness();
    expect(execute(['--bogus'], unknown.io)).toBe(1);
    expect(unknown.stderr.join('')).toContain("unknown option '--bogus'");

    const missing = harness();
    expect(execute(['compile', 'missing.gas'], missing.io)).toBe(1);
    expect(missing.stderr.join('')).toContain("cannot read 'missing.gas'");

    const source = readExample('spec-example');
    const blocked = harness({ 'song.gas': source });
    expect(execute(['compile', 'song.gas', '--out', '/blocked'], blocked.io)).toBe(1);
    expect(blocked.stderr.join('')).toContain("cannot write '/blocked'");
  });
});
