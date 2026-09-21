import { describe, expect, it } from 'vitest';
import { packageName, version } from '../src/index.js';

describe('@luna-estelar/gas-protocol', () => {
  it('exposes package metadata', () => {
    expect(packageName).toBe('@luna-estelar/gas-protocol');
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
