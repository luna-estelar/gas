// Translate GAS effective state into the bridge's weighted style prompts.
//
// MRT2 blends at most six text prompts. The policy is fixed and deterministic:
// - one global prompt (description, key and tempo as text) when there is any;
// - then active tracks, heaviest first, ties in source order;
// - tracks beyond the last slot are folded into that slot's text and weight,
//   and the caller warns once, rather than any track being dropped silently.
// Tempo and key are only described in words: the model has no native control
// for either, so they are approximations.

import type { EffectiveState, EffectiveTrack, IntentValue } from '@luna-estelar/gas/protocol';
import type { MagentaRt2PromptConfig } from './config.js';

export const MAX_PROMPTS = 6;

export type WeightedPrompt = {
  readonly text: string;
  readonly weight: number;
};

export type PromptTranslation = {
  readonly prompts: readonly WeightedPrompt[];
  /** More tracks were active than slots, so some share the last slot. */
  readonly overflowed: boolean;
};

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function textFragment(value: IntentValue | undefined): string | undefined {
  if (value?.kind !== 'text') return undefined;
  const normalized = normalizeText(value.text);
  return normalized.length > 0 ? normalized : undefined;
}

function effectiveLevel(track: EffectiveTrack): number {
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

function joinFragments(fragments: readonly string[]): string {
  let result = '';
  for (const fragment of fragments) {
    if (result.length === 0) result = fragment;
    else result += (/[.!?]$/.test(result) ? ' ' : '. ') + fragment;
  }
  if (result.length > 0 && !/[.!?]$/.test(result)) result += '.';
  return result;
}

function mergeByText(prompts: readonly WeightedPrompt[]): WeightedPrompt[] {
  const order: string[] = [];
  const weights = new Map<string, number>();
  for (const prompt of prompts) {
    const existing = weights.get(prompt.text);
    if (existing === undefined) order.push(prompt.text);
    weights.set(prompt.text, (existing ?? 0) + prompt.weight);
  }
  return order.map((text) => ({ text, weight: weights.get(text)! }));
}

function globalText(state: EffectiveState): string | undefined {
  const tempo = state.globals.tempo;
  const fragments = [
    textFragment(state.globals.flavor),
    state.globals.key !== undefined && normalizeText(state.globals.key).length > 0
      ? `In ${normalizeText(state.globals.key)}`
      : undefined,
    tempo !== undefined && Number.isFinite(tempo) && tempo > 0
      ? `${Math.round(tempo)} BPM`
      : undefined
  ].filter(isDefined);
  return fragments.length > 0 ? joinFragments(fragments) : undefined;
}

export function translatePrompts(
  state: EffectiveState,
  options: MagentaRt2PromptConfig
): PromptTranslation {
  const tracks: WeightedPrompt[] = [];
  for (const track of state.tracks) {
    if (!track.active) continue;
    const level = effectiveLevel(track);
    const weight = options.trackWeight * level;
    if (!(weight > 0)) continue;
    const text = joinFragments(
      [trackIdentity(track), textFragment(track.flavor), textFragment(track.timbre)].filter(
        isDefined
      )
    );
    if (text.length > 0) tracks.push({ text, weight });
  }

  // Nothing is playing: no prompts, and the connector pauses generation.
  if (tracks.length === 0) return { prompts: [], overflowed: false };

  const merged = mergeByText(tracks)
    .map((prompt, order) => ({ prompt, order }))
    .sort((a, b) => b.prompt.weight - a.prompt.weight || a.order - b.order)
    .map(({ prompt }) => prompt);

  const global = globalText(state);
  const prompts: WeightedPrompt[] =
    global !== undefined && options.globalWeight > 0
      ? [{ text: global, weight: options.globalWeight }]
      : [];
  const trackSlots = MAX_PROMPTS - prompts.length;
  if (merged.length <= trackSlots) {
    return { prompts: mergeByText([...prompts, ...merged]), overflowed: false };
  }
  const kept = merged.slice(0, trackSlots - 1);
  const folded = merged.slice(trackSlots - 1);
  const shared: WeightedPrompt = {
    text: folded.map((prompt) => prompt.text).join(' '),
    weight: folded.reduce((sum, prompt) => sum + prompt.weight, 0)
  };
  return { prompts: mergeByText([...prompts, ...kept, shared]), overflowed: true };
}
