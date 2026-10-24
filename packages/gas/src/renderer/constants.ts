// Playback latency and buffer limits shared by renderer scheduling and delivery.
export const LOOKAHEAD_CHUNKS = 1;
export const MAX_LOOKAHEAD_SECONDS = 4;
export const BUFFER_WARNING_SECONDS = 12;
export const BUFFER_HARD_LIMIT_SECONDS = 30;

/** First-audio timeout default and clamp. See `CreateRendererOptions`. */
export const DEFAULT_FIRST_AUDIO_CHUNKS = 3;
export const MIN_FIRST_AUDIO_TIMEOUT_SECONDS = 2;
export const MAX_FIRST_AUDIO_TIMEOUT_SECONDS = 15;

/**
 * How long, in wall time, Stop and Close wait for the connector to release a
 * run before the renderer publishes the local outcome anyway. The connector
 * call continues; only the host stops waiting for it.
 */
export const CONNECTOR_CLEANUP_TIMEOUT_SECONDS = 5;
