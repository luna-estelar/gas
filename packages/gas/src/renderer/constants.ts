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
 * How long, in wall time, a connection may take to close before GAS warns. GAS
 * never waits on it: Stop and Close return at once and the next Play doesn't
 * wait either (rule 2). Wall time, because the audio clock stops while a
 * browser context is suspended.
 */
export const CONNECTOR_CLEANUP_TIMEOUT_SECONDS = 5;

/**
 * How long before a track comes in after a rest GAS resumes the model, so its
 * start-up delay doesn't make the track late. A placeholder until 0.4 step 6
 * measures it. It is at least one lookahead, because silence already handed to
 * the player can't be taken back, so an entry can't be closer than that.
 */
export const RESUME_LEAD_SECONDS = 2;

/** The fade at a cut, where model audio runs into a rest, so the cut doesn't click. */
export const FADE_OUT_SECONDS = 0.01;

/**
 * Held audio past which a paused connection that keeps sending fails the Play.
 * Below it, a backlog only pauses the model.
 */
export const BUFFER_OVERFLOW_SECONDS = 2 * BUFFER_HARD_LIMIT_SECONDS;
