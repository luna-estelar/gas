import { describe, expect, it } from 'vitest';
import type { ConnectorTiming, EffectiveState, EffectiveTrack } from '@luna-estelar/gas/protocol';
import { MAX_PROMPT_BYTES, translatePrompts } from '../src/prompts.js';

const TIMING: ConnectorTiming = {
  tempo: 100,
  timeSignature: { beatsPerBar: 4, beatUnit: 4 },
  secondsPerBar: 2.4
};
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

const WEIGHTS = { globalWeight: 1, trackWeight: 1 };
// Every run has a tempo, so a global prompt is always possible; these leave it
// out where a case is only about tracks.
const TRACKS_ONLY = { globalWeight: 0, trackWeight: 1 };

function track(id: string, extra: Partial<EffectiveTrack> = {}): EffectiveTrack {
  return { trackId: id, name: id, description: `${id} part`, active: true, ...extra };
}

function state(tracks: EffectiveTrack[], globals: EffectiveState['globals'] = {}): EffectiveState {
  return { globals, tracks };
}

describe('Magenta RT2 prompt translation', () => {
  it('puts description, key and tempo in one global prompt ahead of the tracks', () => {
    const result = translatePrompts(
      TIMING,
      state([track('bass')], {
        flavor: { kind: 'text', text: '  dusty   boom bap ' },
        key: 'D dorian',
        tempo: 89.6
      }),
      WEIGHTS
    );
    expect(result).toEqual({
      prompts: [
        { text: 'dusty boom bap. In D dorian. 90 BPM.', weight: 1 },
        { text: 'bass part.', weight: 1 }
      ],
      overflowed: false,
      truncated: false
    });
  });

  it('describes a track by identity, flavor and timbre and weights it by level', () => {
    const result = translatePrompts(
      TIMING,
      state([
        track('keys', {
          flavor: { kind: 'text', text: 'jazzy' },
          timbre: { kind: 'text', text: 'Rhodes' },
          level: { kind: 'level', value: 0.4 }
        })
      ]),
      { globalWeight: 0, trackWeight: 2 }
    );
    expect(result.prompts).toEqual([{ text: 'keys part. jazzy. Rhodes.', weight: 0.8 }]);
  });

  it('leaves out inactive and silent tracks, and sends nothing when none remain', () => {
    expect(
      translatePrompts(
        TIMING,
        state([track('a', { active: false }), track('b', { level: { kind: 'level', value: 0 } })], {
          tempo: 120
        }),
        WEIGHTS
      )
    ).toEqual({ prompts: [], overflowed: false, truncated: false });
  });

  it('orders tracks heaviest first, keeping source order on ties', () => {
    const result = translatePrompts(
      TIMING,
      state([
        track('a', { level: { kind: 'level', value: 0.2 } }),
        track('b'),
        track('c', { level: { kind: 'level', value: 0.2 } }),
        track('d')
      ]),
      TRACKS_ONLY
    );
    expect(result.prompts.map((prompt) => prompt.text)).toEqual([
      'b part.',
      'd part.',
      'a part.',
      'c part.'
    ]);
  });

  it('folds tracks beyond the sixth slot into the last one instead of dropping them', () => {
    const tracks = Array.from({ length: 8 }, (_, index) => track(`t${index}`));
    const result = translatePrompts(TIMING, state(tracks, { tempo: 100 }), WEIGHTS);
    expect(result.overflowed).toBe(true);
    expect(result.prompts).toHaveLength(6);
    expect(result.prompts.at(-1)).toEqual({
      text: 't4 part. t5 part. t6 part. t7 part.',
      weight: 4
    });
    const total = result.prompts.reduce((sum, prompt) => sum + prompt.weight, 0);
    expect(total).toBe(1 + 8);
  });

  it('gives tracks all six slots when the global prompt is weighted out', () => {
    const tracks = Array.from({ length: 6 }, (_, index) => track(`t${index}`));
    const result = translatePrompts(TIMING, state(tracks, { tempo: 100 }), TRACKS_ONLY);
    expect(result).toMatchObject({ overflowed: false });
    expect(result.prompts).toHaveLength(6);
  });

  it('merges tracks whose text is identical', () => {
    const result = translatePrompts(
      TIMING,
      state([track('x', { description: 'strings' }), track('y', { description: 'strings' })]),
      TRACKS_ONLY
    );
    expect(result.prompts).toEqual([{ text: 'strings.', weight: 2 }]);
  });

  it('describes tempo in quarter-note BPM, whatever the meter', () => {
    const sixEight: ConnectorTiming = {
      tempo: 120,
      timeSignature: { beatsPerBar: 6, beatUnit: 8 },
      secondsPerBar: 3
    };
    const result = translatePrompts(sixEight, state([track('a')], { tempo: 120 }), WEIGHTS);
    expect(result.prompts[0]).toEqual({ text: '60 BPM.', weight: 1 });
  });

  it('falls back to the timing tempo and key when the state names none', () => {
    const result = translatePrompts({ ...TIMING, key: 'E minor' }, state([track('a')]), WEIGHTS);
    expect(result.prompts[0]).toEqual({ text: 'In E minor. 100 BPM.', weight: 1 });
  });

  it('keeps every prompt within the bridge text limit, folded ones included', () => {
    const long = 'x'.repeat(290);
    const tracks = Array.from({ length: 7 }, (_, index) =>
      track(`t${index}`, { description: `${long} ${index}` })
    );
    const result = translatePrompts(
      TIMING,
      state(tracks, { flavor: { kind: 'text', text: long } }),
      WEIGHTS
    );
    expect(result.overflowed).toBe(true);
    expect(result.truncated).toBe(true);
    for (const prompt of result.prompts)
      expect(bytes(prompt.text)).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
    // A folded track whose text no longer fits still counts toward the slot's weight.
    expect(result.prompts.reduce((sum, prompt) => sum + prompt.weight, 0)).toBe(1 + 7);
  });

  it('cuts multi-byte text on a character boundary', () => {
    const result = translatePrompts(
      TIMING,
      state([track('a', { description: 'é'.repeat(400) })]),
      WEIGHTS
    );
    const text = result.prompts[1]!.text;
    expect(bytes(text)).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
    expect(text).not.toContain('\uFFFD');
    expect(result.truncated).toBe(true);
  });
});
