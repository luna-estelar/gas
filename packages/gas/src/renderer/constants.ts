// Playback latency and buffer limits shared by renderer scheduling and delivery.
export const LOOKAHEAD_CHUNKS = 1;
export const MAX_LOOKAHEAD_SECONDS = 4;
export const BUFFER_WARNING_SECONDS = 12;
export const BUFFER_HARD_LIMIT_SECONDS = 30;

/** First-audio timeout default and clamp. See `CreateRendererOptions`. */
export const DEFAULT_FIRST_AUDIO_CHUNKS = 3;
export const MIN_FIRST_AUDIO_TIMEOUT_SECONDS = 2;
export const MAX_FIRST_AUDIO_TIMEOUT_SECONDS = 15;
