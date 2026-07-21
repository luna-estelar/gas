import { describe, expect, it } from 'vitest';
import type {
  EffectiveGlobals,
  EffectiveState,
  EffectiveTrack,
  IntentValue
} from '@luna-estelar/gas-protocol';
import { translatePrompts, type PromptTranslationOptions } from '../src/prompts.js';

const PER_TRACK: PromptTranslationOptions = {
  strategy: 'per-track',
  trackWeight: 1,
  globalWeight: 0.8,
  minimumPositiveWeight: 0.05
};

const GLOBAL_PLUS: PromptTranslationOptions = { ...PER_TRACK, strategy: 'global-plus-tracks' };

function text(value: string): IntentValue {
  return { kind: 'text', text: value };
}

function level(value: number): IntentValue {
  return { kind: 'level', value };
}

function makeTrack(overrides: Partial<EffectiveTrack> & { name: string }): EffectiveTrack {
  return {
    trackId: overrides.trackId ?? overrides.name.toLowerCase(),
    active: true,
    ...overrides
  };
}

function makeState(globals: EffectiveGlobals, tracks: readonly EffectiveTrack[]): EffectiveState {
  return { globals, tracks };
}

describe('translatePrompts — fragment construction', () => {
  it('orders per-track fragments: global flavor, identity, flavor, timbre, non-native key', () => {
    const state = makeState({ flavor: text('dreamy'), key: 'D Dorian' }, [
      makeTrack({
        name: 'Pads',
        description: 'warm evolving pads',
        flavor: text('swelling'),
        timbre: text('analog')
      })
    ]);

    const [prompt] = translatePrompts(state, PER_TRACK);
    expect(prompt.text).toBe('dreamy. warm evolving pads. swelling. analog. D Dorian.');
  });

  it('excludes global flavor and key from track prompts in global-plus-tracks', () => {
    const state = makeState({ flavor: text('dreamy'), key: 'D Dorian' }, [
      makeTrack({ name: 'Pads', description: 'warm pads', flavor: text('swelling') })
    ]);

    const prompts = translatePrompts(state, GLOBAL_PLUS);
    const track = prompts.find((p) => p.text.includes('warm pads'));
    expect(track?.text).toBe('warm pads. swelling.');
    expect(track?.text).not.toContain('dreamy');
    expect(track?.text).not.toContain('Dorian');
  });

  it('falls back to the track name when no other fragment exists', () => {
    const state = makeState({}, [makeTrack({ name: 'Bass' })]);
    expect(translatePrompts(state, PER_TRACK)).toEqual([{ text: 'Bass.', weight: 1 }]);
  });

  it('prefers description over name', () => {
    const state = makeState({}, [makeTrack({ name: 'Bass', description: 'sub bass' })]);
    expect(translatePrompts(state, PER_TRACK)[0].text).toBe('sub bass.');
  });

  it('collapses whitespace and never doubles terminal punctuation', () => {
    const state = makeState({ flavor: text('  moody   and   dark! ') }, [
      makeTrack({ name: 'Lead', flavor: text('bright.') })
    ]);
    expect(translatePrompts(state, PER_TRACK)[0].text).toBe('moody and dark! Lead. bright.');
  });

  it('never emits labels, ids, or synthetic headings', () => {
    const state = makeState({ flavor: text('epic') }, [
      makeTrack({ trackId: 'trk-1', name: 'Strings', flavor: text('lush'), timbre: text('warm') })
    ]);
    for (const prompt of translatePrompts(state, GLOBAL_PLUS)) {
      expect(prompt.text).not.toMatch(/global direction:|track:|timbre:|flavor:/i);
      expect(prompt.text).not.toContain('trk-1');
    }
  });
});

describe('translatePrompts — activation and weights', () => {
  it('excludes inactive tracks', () => {
    const state = makeState({}, [
      makeTrack({ name: 'On' }),
      makeTrack({ name: 'Off', active: false })
    ]);
    expect(translatePrompts(state, PER_TRACK).map((p) => p.text)).toEqual(['On.']);
  });

  it('treats a missing level as full weight', () => {
    const state = makeState({}, [makeTrack({ name: 'Pad' })]);
    expect(translatePrompts(state, PER_TRACK)[0].weight).toBe(1);
  });

  it('omits a track whose level is zero', () => {
    const state = makeState({}, [makeTrack({ name: 'Muted', level: level(0) })]);
    expect(translatePrompts(state, PER_TRACK)).toEqual([]);
  });

  it('scales weight by track weight times level', () => {
    const state = makeState({}, [makeTrack({ name: 'Half', level: level(0.5) })]);
    const options = { ...PER_TRACK, trackWeight: 2 };
    expect(translatePrompts(state, options)[0].weight).toBe(1);
  });

  it('applies the positive floor to very quiet tracks', () => {
    const state = makeState({}, [makeTrack({ name: 'Whisper', level: level(0.01) })]);
    expect(translatePrompts(state, PER_TRACK)[0].weight).toBe(0.05);
  });

  it('weights the standalone global prompt with globalWeight', () => {
    const state = makeState({ flavor: text('ambient') }, [makeTrack({ name: 'Pad' })]);
    const [globalPrompt] = translatePrompts(state, GLOBAL_PLUS);
    expect(globalPrompt).toEqual({ text: 'ambient.', weight: 0.8 });
  });
});

describe('translatePrompts — defensive value handling', () => {
  it('ignores non-text flavor and timbre values', () => {
    const state = makeState({ flavor: level(0.5) }, [
      makeTrack({ name: 'Pad', flavor: { kind: 'alda', source: 'c d e' }, timbre: level(0.2) })
    ]);
    expect(translatePrompts(state, PER_TRACK)).toEqual([{ text: 'Pad.', weight: 1 }]);
  });

  it('treats a non-level value in the level slot as full weight', () => {
    const state = makeState({}, [makeTrack({ name: 'Pad', level: text('loud') })]);
    expect(translatePrompts(state, PER_TRACK)[0].weight).toBe(1);
  });

  it('ignores the global level entirely', () => {
    const state = makeState({ flavor: text('warm'), level: level(0.3) }, [
      makeTrack({ name: 'Pad' })
    ]);
    const [globalPrompt] = translatePrompts(state, GLOBAL_PLUS);
    expect(globalPrompt.weight).toBe(0.8);
  });
});

describe('translatePrompts — global prompt existence', () => {
  it('emits no global prompt when no track contributes', () => {
    const state = makeState({ flavor: text('ambient') }, [
      makeTrack({ name: 'Muted', level: level(0) })
    ]);
    expect(translatePrompts(state, GLOBAL_PLUS)).toEqual([]);
  });

  it('emits no global prompt when there is no global fragment', () => {
    const state = makeState({ key: 'C major' }, [makeTrack({ name: 'Pad' })]);
    expect(translatePrompts(state, GLOBAL_PLUS)).toEqual([{ text: 'Pad.', weight: 1 }]);
  });

  it('places the global prompt first when it exists', () => {
    const state = makeState({ flavor: text('cinematic') }, [
      makeTrack({ name: 'Strings' }),
      makeTrack({ name: 'Brass' })
    ]);
    expect(translatePrompts(state, GLOBAL_PLUS).map((p) => p.text)).toEqual([
      'cinematic.',
      'Strings.',
      'Brass.'
    ]);
  });
});

describe('translatePrompts — duplicate combination', () => {
  it('sums weights of byte-identical track prompts, keeping first position', () => {
    const state = makeState({}, [
      makeTrack({ trackId: 'a', name: 'Pad', level: level(0.5) }),
      makeTrack({ trackId: 'b', name: 'Lead' }),
      makeTrack({ trackId: 'c', name: 'Pad', level: level(0.5) })
    ]);
    expect(translatePrompts(state, PER_TRACK)).toEqual([
      { text: 'Pad.', weight: 1 },
      { text: 'Lead.', weight: 1 }
    ]);
  });

  it('merges a track prompt into an identical global prompt', () => {
    const state = makeState({ flavor: text('ambient') }, [makeTrack({ name: 'ambient' })]);
    expect(translatePrompts(state, GLOBAL_PLUS)).toEqual([{ text: 'ambient.', weight: 1.8 }]);
  });
});

describe('translatePrompts — key handling', () => {
  it('omits a native key from prompt text in both strategies', () => {
    const state = makeState({ flavor: text('warm'), key: 'A minor' }, [makeTrack({ name: 'Pad' })]);
    for (const prompt of [
      ...translatePrompts(state, PER_TRACK),
      ...translatePrompts(state, GLOBAL_PLUS)
    ]) {
      expect(prompt.text).not.toMatch(/minor/i);
    }
  });

  it('keeps a modal key in the per-track prompt', () => {
    const state = makeState({ key: 'E Phrygian' }, [makeTrack({ name: 'Pad' })]);
    expect(translatePrompts(state, PER_TRACK)[0].text).toBe('Pad. E Phrygian.');
  });

  it('keeps a modal key in the global prompt for global-plus-tracks', () => {
    const state = makeState({ key: 'E Phrygian' }, [makeTrack({ name: 'Pad' })]);
    expect(translatePrompts(state, GLOBAL_PLUS).map((p) => p.text)).toEqual([
      'E Phrygian.',
      'Pad.'
    ]);
  });
});
