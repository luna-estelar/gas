import { describe, expect, it } from 'vitest';
import { packageName, version } from '../src/index.js';

describe('@luna-estelar/gas-api', () => {
  it('exposes package metadata', () => {
    expect(packageName).toBe('@luna-estelar/gas-api');
    expect(version).toBe('0.1.0');
  });
});
