// Translate effective state into weighted Lyria prompts. Authored phrases retain their wording
// with whitespace normalized. Per-track prompts include global mood; global-plus-tracks
// sends global mood separately alongside the track prompts.

import type { EffectiveState, EffectiveTrack, IntentValue } from '@luna-estelar/gas-protocol';
import type { LyriaPromptStrategy } from './config.js';
import { classifyKey } from './scale.js';

export type WeightedPrompt = {
  readonly text: string;
  readonly weight: number;
};

export type PromptTranslationOptions = {
  readonly strategy: LyriaPromptStrategy;
  readonly trackWeight: number;
  readonly globalWeight: number;
  readonly minimumPositiveWeight: number;
};

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Text of a text-kind intent value, trimmed and collapsed; undefined otherwise. */
function textFragment(value: IntentValue | undefined): string | undefined {
  if (value?.kind !== 'text') return undefined;
  const normalized = normalizeText(value.text);
  return normalized.length > 0 ? normalized : undefined;
}

/** Effective level for weighting: a level value (including 0), otherwise 1. */
function effectiveLevel(track: EffectiveTrack): number {
  return track.level?.kind === 'level' ? track.level.value : 1;
}

/** A track's identity fragment: non-empty description, otherwise its name. */
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

/** Sum weights of byte-identical prompt texts, keeping first-occurrence order. */
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

export function translatePrompts(
  state: EffectiveState,
  options: PromptTranslationOptions
): readonly WeightedPrompt[] {
  const { strategy, trackWeight, globalWeight, minimumPositiveWeight } = options;
  const foldGlobal = strategy === 'per-track';

  const globalFlavor = textFragment(state.globals.flavor);

  let nonNativeKey: string | undefined;
  if (state.globals.key !== undefined) {
    const classification = classifyKey(state.globals.key);
    if (classification.nativeScale === 'none') {
      const normalized = normalizeText(classification.promptText);
      nonNativeKey = normalized.length > 0 ? normalized : undefined;
    }
  }

  const trackPrompts: WeightedPrompt[] = [];
  for (const track of state.tracks) {
    if (!track.active) continue;
    const level = effectiveLevel(track);
    if (level === 0) continue;

    const fragments = foldGlobal
      ? [
          globalFlavor,
          trackIdentity(track),
          textFragment(track.flavor),
          textFragment(track.timbre),
          nonNativeKey
        ]
      : [trackIdentity(track), textFragment(track.flavor), textFragment(track.timbre)];
    const text = joinFragments(fragments.filter(isDefined));
    if (text.length === 0) continue;

    trackPrompts.push({ text, weight: Math.max(minimumPositiveWeight, trackWeight * level) });
  }

  let prompts: readonly WeightedPrompt[] = trackPrompts;
  if (!foldGlobal && trackPrompts.length > 0) {
    const globalFragments = [globalFlavor, nonNativeKey].filter(isDefined);
    if (globalFragments.length > 0) {
      prompts = [{ text: joinFragments(globalFragments), weight: globalWeight }, ...trackPrompts];
    }
  }

  return mergeByText(prompts);
}
