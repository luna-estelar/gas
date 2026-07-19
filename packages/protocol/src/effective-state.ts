import type { IntentValue, TimeSignature } from './timeline.js';

export interface EffectiveGlobals {
  readonly flavor?: IntentValue;
  readonly level?: IntentValue;
  readonly tempo?: number;
  readonly key?: string;
  readonly timeSignature?: TimeSignature;
}

export interface EffectiveTrack {
  readonly trackId: string;
  readonly name: string;
  readonly description?: string;
  readonly active: boolean;
  readonly flavor?: IntentValue;
  readonly timbre?: IntentValue;
  readonly level?: IntentValue;
  readonly notes?: IntentValue;
  readonly motif?: IntentValue;
}

export interface EffectiveState {
  readonly globals: EffectiveGlobals;
  readonly tracks: readonly EffectiveTrack[];
}
