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
  createTempoSegmentMap,
  DEFAULT_TEMPO,
  DEFAULT_TIME_SIGNATURE,
  positionToTime,
  reanchorTempo,
  resolveTiming,
  secondsPerBar,
  secondsPerBeat,
  TICKS_PER_BEAT,
  timeToBarFraction,
  timeToPosition
} from '@luna-estelar/gas-core';
export type { RendererErrorCode } from './errors.js';
export { RendererError } from './errors.js';
export type { SanitizedSchemaProblem } from './connector-config.js';
export type { CreateRendererOptions } from './renderer.js';
export { createRenderer } from './renderer.js';
export type { AudioAccounting } from './audio.js';
export { applyS16leGain, BufferLedger } from './audio.js';
export {
  BUFFER_HARD_LIMIT_SECONDS,
  BUFFER_WARNING_SECONDS,
  LOOKAHEAD_CHUNKS,
  MAX_LOOKAHEAD_SECONDS
} from './constants.js';

export const packageName = '@luna-estelar/gas-renderer';
export const version = '0.1.1';
