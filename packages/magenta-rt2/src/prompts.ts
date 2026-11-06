// Translate GAS effective state into the bridge's weighted style prompts.
//
// MRT2 blends at most six text prompts. The policy is fixed and deterministic:
// - one global prompt (description, key and tempo as text) when there is any;
// - then active tracks, heaviest first, ties in source order;
// - tracks beyond the last slot are folded into that slot's text and weight,
//   and the caller warns once, rather than any track being dropped silently;
// - every prompt fits the bridge's text limit, measured in UTF-8 bytes, and a
//   cut is reported so the caller can warn.
// Tempo and key are only described in words: the model has no native control
// for either, so they are approximations. Tempo is given in quarter-note BPM,
// the way music is usually described, whatever the meter's beat unit.

import type {
  ConnectorTiming,
  EffectiveState,
  EffectiveTrack,
  IntentValue
} from '@luna-estelar/gas/protocol';
import type { MagentaRt2PromptConfig } from './config.js';

export const MAX_PROMPTS = 6;
/** The bridge refuses prompt text longer than this many UTF-8 bytes. */
export const MAX_PROMPT_BYTES = 512;

export type WeightedPrompt = {
  readonly text: string;
  readonly weight: number;
};

export type PromptTranslation = {
  readonly prompts: readonly WeightedPrompt[];
  /** More tracks were active than slots, so some share the last slot. */
  readonly overflowed: boolean;
  /** Some text was cut to fit the bridge's limit. */
  readonly truncated: boolean;
};

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

/**
 * The longest prefix of `text` within `budget` UTF-8 bytes, cut at a word break
 * when there is one and never inside a character.
 */
function fitText(text: string, budget = MAX_PROMPT_BYTES): string {
  if (byteLength(text) <= budget) return text;
  let fitted = '';
  let used = 0;
  for (const character of text) {
    const size = byteLength(character);
    if (used + size > budget) break;
    fitted += character;
    used += size;
  }
  const lastSpace = fitted.lastIndexOf(' ');
  return (lastSpace > 0 ? fitted.slice(0, lastSpace) : fitted).trimEnd();
}

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

function globalText(state: EffectiveState, timing: ConnectorTiming): string | undefined {
  // The state names what the document overrides; timing carries the run's
  // defaults, including any the host supplied.
  const tempo = state.globals.tempo ?? timing.tempo;
  const beatUnit = (state.globals.timeSignature ?? timing.timeSignature).beatUnit;
  const quarterTempo = (tempo * 4) / beatUnit;
  const key = normalizeText(state.globals.key ?? timing.key ?? '');
  const fragments = [
    textFragment(state.globals.flavor),
    key.length > 0 ? `In ${key}` : undefined,
    Number.isFinite(quarterTempo) && quarterTempo > 0
      ? `${Math.round(quarterTempo)} BPM`
      : undefined
  ].filter(isDefined);
  return fragments.length > 0 ? joinFragments(fragments) : undefined;
}

/** Folds several prompts into one slot: texts joined while they fit, all weights kept. */
function fold(prompts: readonly WeightedPrompt[]): { prompt: WeightedPrompt; cut: boolean } {
  let text = '';
  let cut = false;
  for (const prompt of prompts) {
    const joined = text.length === 0 ? prompt.text : `${text} ${prompt.text}`;
    if (byteLength(joined) <= MAX_PROMPT_BYTES) text = joined;
    else cut = true;
  }
  if (text.length === 0) {
    text = fitText(prompts[0]!.text);
    cut = true;
  }
  return {
    prompt: { text, weight: prompts.reduce((sum, prompt) => sum + prompt.weight, 0) },
    cut
  };
}

export function translatePrompts(
  timing: ConnectorTiming,
  state: EffectiveState,
  options: MagentaRt2PromptConfig
): PromptTranslation {
  let truncated = false;
  const fit = (text: string): string => {
    const fitted = fitText(text);
    if (fitted !== text) truncated = true;
    return fitted;
  };

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
    if (text.length > 0) tracks.push({ text: fit(text), weight });
  }

  // Nothing is playing: no prompts, and the connector pauses generation.
  if (tracks.length === 0) return { prompts: [], overflowed: false, truncated: false };

  const merged = mergeByText(tracks)
    .map((prompt, order) => ({ prompt, order }))
    .sort((a, b) => b.prompt.weight - a.prompt.weight || a.order - b.order)
    .map(({ prompt }) => prompt);

  const global = globalText(state, timing);
  const prompts: WeightedPrompt[] =
    global !== undefined && options.globalWeight > 0
      ? [{ text: fit(global), weight: options.globalWeight }]
      : [];
  const trackSlots = MAX_PROMPTS - prompts.length;
  if (merged.length <= trackSlots) {
    return { prompts: mergeByText([...prompts, ...merged]), overflowed: false, truncated };
  }
  const kept = merged.slice(0, trackSlots - 1);
  const shared = fold(merged.slice(trackSlots - 1));
  return {
    prompts: mergeByText([...prompts, ...kept, shared.prompt]),
    overflowed: true,
    truncated: truncated || shared.cut
  };
}
