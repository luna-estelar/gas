// Inspect effective state through Core without loading the language compiler.
import {
  createInputState,
  effectiveStateAt,
  sectionInstanceAt,
  type EffectiveState
} from '@luna-estelar/gas-core';
// Type-only, so nothing survives compilation and there is no runtime cycle with
// compile.ts (which re-exports this module's surface). timeline.ts does the same.
import type { CompiledTimeline } from './compile.js';

export type EffectiveSnapshot = EffectiveState;

export interface Inspection {
  readonly bar: number;
  readonly sectionName?: string;
  readonly state: EffectiveSnapshot;
}

export function inspectTimeline(timeline: CompiledTimeline, requestedBar: number): Inspection {
  const maximum = Math.max(1, timeline.arrangedBars);
  const bar = Math.min(maximum, Math.max(1, Math.round(requestedBar)));
  const position = { bar };
  const section = sectionInstanceAt(timeline, position);
  return {
    bar,
    sectionName: section?.sectionName,
    state: effectiveStateAt(createInputState(timeline), position, {
      loopIteration: 0,
      activeSection: section
    })
  };
}
