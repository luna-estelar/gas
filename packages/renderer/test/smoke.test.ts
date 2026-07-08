import { describe, expect, it } from 'vitest';
import { packageName, version } from '../src/index.js';

describe('@luna-estelar/gas-renderer', () => {
  it('exposes package metadata', () => {
    expect(packageName).toBe('@luna-estelar/gas-renderer');
    expect(version).toBe('0.1.0');
  });
});
