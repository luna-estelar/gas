import { describe, expect, it } from 'vitest';
import { packageName, version } from '../src/index.js';

describe('@luna-estelar/gas-core', () => {
  it('exposes package metadata', () => {
    expect(packageName).toBe('@luna-estelar/gas-core');
    expect(version).toBe('0.1.0');
  });
});
