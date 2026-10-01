// @luna-estelar/gas-renderer
// Owns audio generation and playback: a host-supplied monotonic clock,
// scheduled callbacks, musical-to-clock conversion, tempo/meter defaults, the
// current session input state with effective-state derivation through
// gas-core, and one active connector instance per session. Contains no
// application-facing GAS syntax parsing and does not depend on any specific
// connector.

// Musical-time conversion is owned by Core, so a host can share it without
// depending on the Renderer. Re-exported here because these have always been
// part of this package's surface.
export type { ResolvedTiming, TempoSegment, TempoSegmentMap } from '@luna-estelar/gas-core';
export {
  barToTime,
  comparePositions,
  createTempoSegmentMap,
  DEFAULT_TEMPO,
  DEFAULT_TIME_SIGNATURE,
  positionsEqual,
  positionToTime,
  reanchorTempo,
  resolveTiming,
  secondsPerBar,
  secondsPerBeat,
  TICKS_PER_BEAT,
  timeToBarFraction,
  timeToPosition
} from '@luna-estelar/gas-core';
export type { RendererErrorCode, RendererProblem } from './errors.js';
export { RendererError } from './errors.js';
export type { CreateRendererOptions } from './renderer.js';
export { createRenderer } from './renderer.js';
export type { AudioAccounting } from './audio.js';
export { applyS16leGain, BufferLedger } from './audio.js';
export {
  BUFFER_HARD_LIMIT_SECONDS,
  BUFFER_WARNING_SECONDS,
  DEFAULT_FIRST_AUDIO_CHUNKS,
  LOOKAHEAD_CHUNKS,
  MAX_FIRST_AUDIO_TIMEOUT_SECONDS,
  MAX_LOOKAHEAD_SECONDS,
  MIN_FIRST_AUDIO_TIMEOUT_SECONDS
} from './constants.js';

export const version = '0.2.0';
