// Translate effective state into weighted style prompts for the bridge, which
// embeds each one with MusicCoCa and blends them by normalized weight. Authored
// phrases keep their wording with whitespace normalized. Magenta RealTime 2 has
// no tempo or key control, so both ride in the global prompt as words.

import type {
  EffectiveState,
  EffectiveTrack,
  IntentValue,
  TimeSignature
} from '@luna-estelar/gas-protocol';
import type { MagentaPromptConfig } from './config.js';

export type WeightedPrompt = {
  readonly text: string;
  readonly weight: number;
};

export type PromptTranslationOptions = MagentaPromptConfig;

/** What the prompts may describe beyond the state: the run's meter and fallbacks. */
export type PromptContext = {
  readonly tempo: number;
  readonly timeSignature: TimeSignature;
  readonly key?: string;
};

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function textFragment(value: IntentValue | undefined): string | undefined {
  if (value?.kind !== 'text') return undefined;
  const normalized = normalizeText(value.text);
  return normalized.length > 0 ? normalized : undefined;
}

/** Effective level for weighting: a level value (including 0), otherwise 1. */
export function effectiveLevel(track: EffectiveTrack): number {
  return track.level?.kind === 'level' ? track.level.value : 1;
}

function trackIdentity(track: EffectiveTrack): string | undefined {
  const description = track.description !== undefined ? normalizeText(track.description) : '';
  if (description.length > 0) return description;
  const name = normalizeText(track.name);
  return name.length > 0 ? name : undefined;
}

function isDefined(value: string | undefined): value is string {
  return value !== undefined;
}

/** Join non-empty fragments with `. `, avoiding doubled terminal punctuation. */
function joinFragments(fragments: readonly string[]): string {
  let result = '';
  for (const fragment of fragments) {
    if (result.length === 0) {
      result = fragment;
    } else {
      result += (/[.!?]$/.test(result) ? ' ' : '. ') + fragment;
    }
  }
  if (result.length > 0 && !/[.!?]$/.test(result)) result += '.';
  return result;
}

function mergeByText(prompts: readonly WeightedPrompt[]): WeightedPrompt[] {
  const order: string[] = [];
  const weights = new Map<string, number>();
  for (const prompt of prompts) {
    const existing = weights.get(prompt.text);
    if (existing === undefined) {
      order.push(prompt.text);
      weights.set(prompt.text, prompt.weight);
    } else {
      weights.set(prompt.text, existing + prompt.weight);
    }
  }
  return order.map((text) => ({ text, weight: weights.get(text) as number }));
}

/**
 * Quarter-note tempo as words. A GAS tempo counts the meter's beat unit, so 120
 * in 6/8 is 60 quarter notes a minute, which is what a listener would call it.
 */
function tempoFragment(state: EffectiveState, context: PromptContext): string {
  const tempo = state.globals.tempo ?? context.tempo;
  const quarterTempo = Math.round((tempo * 4) / context.timeSignature.beatUnit);
  return `${quarterTempo} bpm`;
}

function keyFragment(state: EffectiveState, context: PromptContext): string | undefined {
  const key = state.globals.key ?? context.key;
  if (key === undefined) return undefined;
  const normalized = normalizeText(key);
  return normalized.length > 0 ? `in ${normalized}` : undefined;
}

export function translatePrompts(
  state: EffectiveState,
  options: PromptTranslationOptions,
  context: PromptContext
): readonly WeightedPrompt[] {
  const { strategy, trackWeight, globalWeight, minimumPositiveWeight } = options;
  const foldGlobal = strategy === 'per-track';

  const musical = [
    options.describeTempo ? tempoFragment(state, context) : undefined,
    options.describeKey ? keyFragment(state, context) : undefined
  ].filter(isDefined);
  const globalFragments = [
    textFragment(state.globals.flavor),
    ...(musical.length > 0 ? [musical.join(', ')] : [])
  ].filter(isDefined);

  const trackPrompts: WeightedPrompt[] = [];
  for (const track of state.tracks) {
    if (!track.active) continue;
    const level = effectiveLevel(track);
    if (level === 0) continue;

    const own = [trackIdentity(track), textFragment(track.flavor), textFragment(track.timbre)];
    const fragments = foldGlobal ? [...own, ...globalFragments] : own;
    const text = joinFragments(fragments.filter(isDefined));
    if (text.length === 0) continue;

    trackPrompts.push({ text, weight: Math.max(minimumPositiveWeight, trackWeight * level) });
  }

  let prompts: readonly WeightedPrompt[] = trackPrompts;
  if (!foldGlobal && trackPrompts.length > 0 && globalFragments.length > 0) {
    prompts = [{ text: joinFragments(globalFragments), weight: globalWeight }, ...trackPrompts];
  }

  return mergeByText(prompts);
}
