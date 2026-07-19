// @luna-estelar/gas-renderer
// Owns audio generation and playback: a host-supplied monotonic clock,
// scheduled callbacks, musical-to-clock conversion, tempo/meter defaults, the
// current session input state with effective-state derivation through
// gas-core, and one active connector instance per session. Contains no
// application-facing GAS syntax parsing and does not depend on any specific
// connector.

export type { ResolvedTiming, TempoSegment, TempoSegmentMap } from './musical-time.js';
export {
  barToTime,
  createTempoSegmentMap,
  DEFAULT_TEMPO,
  DEFAULT_TIME_SIGNATURE,
  reanchorTempo,
  resolveTiming,
  secondsPerBar,
  secondsPerBeat,
  timeToBar
} from './musical-time.js';

export const packageName = '@luna-estelar/gas-renderer';
export const version = '0.1.0';
