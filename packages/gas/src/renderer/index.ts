// Owns audio generation and playback: a host-supplied monotonic clock,
// scheduled callbacks, musical-to-clock conversion, tempo/meter defaults, the
// current session input state with effective-state derivation through
// core, and one active connector instance per session. Contains no
// application-facing GAS syntax parsing and does not depend on any specific
// connector.

// Musical-time conversion lives in Core so a host can use it without the
// Renderer; re-exported for Renderer consumers.
export type { ResolvedTiming, TempoSegment, TempoSegmentMap } from '../core/index.js';
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
} from '../core/index.js';
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
