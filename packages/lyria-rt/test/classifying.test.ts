import { describe, expect, it } from 'vitest';
import { classifyKey, type LyriaScale } from '../src/scale.js';

function scaleOf(key: string): LyriaScale | 'none' {
  return classifyKey(key).nativeScale;
}

describe('classifyKey — major keys', () => {
  const majors: ReadonlyArray<readonly [string, LyriaScale]> = [
    ['C major', 'C_MAJOR_A_MINOR'],
    ['Db major', 'D_FLAT_MAJOR_B_FLAT_MINOR'],
    ['D major', 'D_MAJOR_B_MINOR'],
    ['Eb major', 'E_FLAT_MAJOR_C_MINOR'],
    ['E major', 'E_MAJOR_D_FLAT_MINOR'],
    ['F major', 'F_MAJOR_D_MINOR'],
    ['Gb major', 'G_FLAT_MAJOR_E_FLAT_MINOR'],
    ['G major', 'G_MAJOR_E_MINOR'],
    ['Ab major', 'A_FLAT_MAJOR_F_MINOR'],
    ['A major', 'A_MAJOR_G_FLAT_MINOR'],
    ['Bb major', 'B_FLAT_MAJOR_G_MINOR'],
    ['B major', 'B_MAJOR_A_FLAT_MINOR']
  ];

  it.each(majors)('maps %s to %s', (key, scale) => {
    expect(scaleOf(key)).toBe(scale);
  });
});

describe('classifyKey — minor keys', () => {
  const minors: ReadonlyArray<readonly [string, LyriaScale]> = [
    ['A minor', 'C_MAJOR_A_MINOR'],
    ['Bb minor', 'D_FLAT_MAJOR_B_FLAT_MINOR'],
    ['B minor', 'D_MAJOR_B_MINOR'],
    ['C minor', 'E_FLAT_MAJOR_C_MINOR'],
    ['Db minor', 'E_MAJOR_D_FLAT_MINOR'],
    ['D minor', 'F_MAJOR_D_MINOR'],
    ['Eb minor', 'G_FLAT_MAJOR_E_FLAT_MINOR'],
    ['E minor', 'G_MAJOR_E_MINOR'],
    ['F minor', 'A_FLAT_MAJOR_F_MINOR'],
    ['Gb minor', 'A_MAJOR_G_FLAT_MINOR'],
    ['G minor', 'B_FLAT_MAJOR_G_MINOR'],
    ['Ab minor', 'B_MAJOR_A_FLAT_MINOR']
  ];

  it.each(minors)('maps %s to %s', (key, scale) => {
    expect(scaleOf(key)).toBe(scale);
  });
});

describe('classifyKey — enharmonic spellings', () => {
  const enharmonics: ReadonlyArray<readonly [string, string]> = [
    ['C# major', 'Db major'],
    ['D# major', 'Eb major'],
    ['F# major', 'Gb major'],
    ['G# major', 'Ab major'],
    ['A# major', 'Bb major'],
    ['C# minor', 'Db minor'],
    ['D# minor', 'Eb minor'],
    ['F# minor', 'Gb minor'],
    ['G# minor', 'Ab minor'],
    ['A# minor', 'Bb minor']
  ];

  it.each(enharmonics)('treats %s the same as %s', (sharp, flat) => {
    expect(scaleOf(sharp)).toBe(scaleOf(flat));
    expect(scaleOf(sharp)).not.toBe('none');
  });

  it('resolves boundary spellings that cross a letter', () => {
    expect(scaleOf('Cb major')).toBe('B_MAJOR_A_FLAT_MINOR');
    expect(scaleOf('B# major')).toBe('C_MAJOR_A_MINOR');
    expect(scaleOf('E# major')).toBe('F_MAJOR_D_MINOR');
    expect(scaleOf('Fb major')).toBe('E_MAJOR_D_FLAT_MINOR');
  });
});

describe('classifyKey — tolerance', () => {
  it('ignores case and surrounding or repeated whitespace', () => {
    expect(scaleOf('  f#   MINOR ')).toBe('A_MAJOR_G_FLAT_MINOR');
    expect(scaleOf('c MAJOR')).toBe('C_MAJOR_A_MINOR');
    expect(scaleOf('Bb Minor')).toBe('D_FLAT_MAJOR_B_FLAT_MINOR');
  });
});

describe('classifyKey — passthrough', () => {
  const passthrough = ['D Dorian', 'C mixolydian', 'H major', '', 'C', 'C♯ major', 'F#'];

  it.each(passthrough)('reports %j as not native and keeps the original text', (key) => {
    const result = classifyKey(key);
    expect(result.nativeScale).toBe('none');
    if (result.nativeScale === 'none') {
      expect(result.promptText).toBe(key);
    }
  });
});
