import { describe, expect, it } from 'vitest';
import type { EffectiveState, EffectiveTrack } from '@luna-estelar/gas/protocol';
import { translatePrompts } from '../src/prompts.js';

const WEIGHTS = { globalWeight: 1, trackWeight: 1 };

function track(id: string, extra: Partial<EffectiveTrack> = {}): EffectiveTrack {
  return { trackId: id, name: id, description: `${id} part`, active: true, ...extra };
}

function state(tracks: EffectiveTrack[], globals: EffectiveState['globals'] = {}): EffectiveState {
  return { globals, tracks };
}

describe('Magenta RT2 prompt translation', () => {
  it('puts description, key and tempo in one global prompt ahead of the tracks', () => {
    const result = translatePrompts(
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
      overflowed: false
    });
  });

  it('describes a track by identity, flavor and timbre and weights it by level', () => {
    const result = translatePrompts(
      state([
        track('keys', {
          flavor: { kind: 'text', text: 'jazzy' },
          timbre: { kind: 'text', text: 'Rhodes' },
          level: { kind: 'level', value: 0.4 }
        })
      ]),
      { globalWeight: 1, trackWeight: 2 }
    );
    expect(result.prompts).toEqual([{ text: 'keys part. jazzy. Rhodes.', weight: 0.8 }]);
  });

  it('leaves out inactive and silent tracks, and sends nothing when none remain', () => {
    expect(
      translatePrompts(
        state([track('a', { active: false }), track('b', { level: { kind: 'level', value: 0 } })], {
          tempo: 120
        }),
        WEIGHTS
      )
    ).toEqual({ prompts: [], overflowed: false });
  });

  it('orders tracks heaviest first, keeping source order on ties', () => {
    const result = translatePrompts(
      state([
        track('a', { level: { kind: 'level', value: 0.2 } }),
        track('b'),
        track('c', { level: { kind: 'level', value: 0.2 } }),
        track('d')
      ]),
      WEIGHTS
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
    const result = translatePrompts(state(tracks, { tempo: 100 }), WEIGHTS);
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
    const result = translatePrompts(state(tracks, { tempo: 100 }), {
      globalWeight: 0,
      trackWeight: 1
    });
    expect(result).toMatchObject({ overflowed: false });
    expect(result.prompts).toHaveLength(6);
  });

  it('merges tracks whose text is identical', () => {
    const result = translatePrompts(
      state([track('x', { description: 'strings' }), track('y', { description: 'strings' })]),
      WEIGHTS
    );
    expect(result.prompts).toEqual([{ text: 'strings.', weight: 2 }]);
  });
});
