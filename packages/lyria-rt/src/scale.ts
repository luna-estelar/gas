// Native key classification. Lyria RealTime exposes twelve scale settings, each pairing a
// major key with its relative minor. This module maps an authored key string to
// one of those twelve when it names a plain major or minor key (any enharmonic
// spelling), and otherwise reports that the key is not native so it can travel
// as prompt text instead. This is the only prompt-stage code that names the
// vendor scale values; the transport stage consumes the classification.

export const LYRIA_RT_SCALES = [
  'C_MAJOR_A_MINOR',
  'D_FLAT_MAJOR_B_FLAT_MINOR',
  'D_MAJOR_B_MINOR',
  'E_FLAT_MAJOR_C_MINOR',
  'E_MAJOR_D_FLAT_MINOR',
  'F_MAJOR_D_MINOR',
  'G_FLAT_MAJOR_E_FLAT_MINOR',
  'G_MAJOR_E_MINOR',
  'A_FLAT_MAJOR_F_MINOR',
  'A_MAJOR_G_FLAT_MINOR',
  'B_FLAT_MAJOR_G_MINOR',
  'B_MAJOR_A_FLAT_MINOR'
] as const;

export type LyriaRtScale = (typeof LYRIA_RT_SCALES)[number];

export type KeyClassification =
  | { readonly nativeScale: LyriaRtScale }
  | { readonly nativeScale: 'none'; readonly promptText: string };

// Scale indexed by the pitch class of its major tonic (0 = C .. 11 = B).
const SCALE_BY_MAJOR_PITCH_CLASS: readonly LyriaRtScale[] = LYRIA_RT_SCALES;

const TONIC_PITCH_CLASS: Readonly<Record<string, number>> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11
};

const KEY_PATTERN = /^([a-g])([#b]?) (major|minor)$/;

/**
 * Classify an authored key string against Lyria RealTime's twelve native scales.
 * Accepts a case-insensitive tonic with an optional ASCII `#`/`b`, followed by
 * `major` or `minor`. Every enharmonic spelling resolves through the tonic's
 * pitch class, so `C# major` and `Db major` land on the same scale, and a minor
 * key resolves via its relative major (three semitones up). Anything else —
 * modes, unknown tonics, Unicode accidentals, empty input — is reported as
 * `none` with the original text preserved for prompt use.
 */
export function classifyKey(key: string): KeyClassification {
  const normalized = key.trim().replace(/\s+/g, ' ').toLowerCase();
  const match = KEY_PATTERN.exec(normalized);
  if (match === null) {
    return { nativeScale: 'none', promptText: key };
  }

  const [, letter, accidental, mode] = match;
  const accidentalShift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  const tonicPitchClass = (TONIC_PITCH_CLASS[letter] + accidentalShift + 12) % 12;
  const majorPitchClass = mode === 'minor' ? (tonicPitchClass + 3) % 12 : tonicPitchClass;

  return { nativeScale: SCALE_BY_MAJOR_PITCH_CLASS[majorPitchClass] };
}
