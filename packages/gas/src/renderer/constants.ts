// Latency and buffer limits for scheduling and delivering audio.
export const LOOKAHEAD_CHUNKS = 1;
export const MAX_LOOKAHEAD_SECONDS = 4;
export const BUFFER_WARNING_SECONDS = 12;
export const BUFFER_HARD_LIMIT_SECONDS = 30;

/** First-audio timeout default and clamp. See `CreateRendererOptions`. */
export const DEFAULT_FIRST_AUDIO_CHUNKS = 3;
export const MIN_FIRST_AUDIO_TIMEOUT_SECONDS = 2;
export const MAX_FIRST_AUDIO_TIMEOUT_SECONDS = 15;

/**
 * How long, in wall time, a connection may take to close before GAS warns. GAS
 * never waits on it: Stop and Close return at once and the next Play doesn't
 * wait either (rule 2). Wall time, because the audio clock stops while a
 * browser context is suspended.
 */
export const CONNECTION_CLOSE_TIMEOUT_SECONDS = 5;

/**
 * The start-up delay GAS assumes for a model that doesn't report
 * `startupDelaySeconds`. GAS resumes the model this much plus one lookahead
 * before a track comes in after a rest: audio for the entry has to arrive a
 * lookahead early to be handed to the player in time. See
 * plans/gas-0.4/gas-0.4-startup-delay.md for the measurements.
 */
export const DEFAULT_STARTUP_DELAY_SECONDS = 2;

/** The most a model's reported start-up delay may add to the resume lead. */
export const MAX_STARTUP_DELAY_SECONDS = 10;

/** The fade at a cut, where model audio runs into a rest, so the cut doesn't click. */
export const FADE_OUT_SECONDS = 0.01;

/**
 * Held audio past which a paused connection that keeps sending fails the Play.
 * Below it, a backlog only pauses the model.
 */
export const BUFFER_OVERFLOW_SECONDS = 2 * BUFFER_HARD_LIMIT_SECONDS;
