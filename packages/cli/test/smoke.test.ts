import { describe, expect, it } from 'vitest';
import { packageName, run, version } from '../src/index.js';

describe('@luna-estelar/gas-cli', () => {
  it('exposes package metadata', () => {
    expect(packageName).toBe('@luna-estelar/gas-cli');
    expect(version).toBe('0.1.0');
  });

  it('exits zero for normal invocation', () => {
    process.exitCode = 0;
    run([]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('exits nonzero for an unrecognized option', () => {
    process.exitCode = 0;
    run(['--bogus']);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
