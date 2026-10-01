// Opening an AudioContext. Browsers keep a context suspended unless it resumes
// during a user gesture, so these helpers do nothing asynchronous first.

// How long to wait for `resume()` before reporting what the context's own state
// says. A browser that refuses to start audio may reject, but it may also leave
// the promise pending indefinitely, which the Web Audio specification permits.
// Awaiting it unconditionally would hang every caller, so this is a bound on the
// wait, not a policy: `resumed` is read from `context.state` either way, and a
// context that starts later is still usable — the caller holds it and can watch
// `statechange`.
const RESUME_TIMEOUT_MS = 1000;

export interface OpenAudioContextOptions {
  readonly sampleRate?: number;
  /** Defaults to `'playback'`: steady streamed audio, not interactive sound effects. */
  readonly latencyHint?: AudioContextLatencyCategory;
}

export interface OpenedAudioContext {
  readonly context: AudioContext;
  /** False when the browser refused to start audio, usually for want of a gesture. */
  readonly resumed: boolean;
}

/** Call from the gesture's own handler, before any `await`. */
export async function openAudioContext(
  options: OpenAudioContextOptions = {}
): Promise<OpenedAudioContext> {
  const context = new AudioContext({
    latencyHint: options.latencyHint ?? 'playback',
    ...(options.sampleRate !== undefined ? { sampleRate: options.sampleRate } : {})
  });
  // Started before the first await, so the request still carries the gesture.
  const resuming = context.resume();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      // A rejection is one of the answers, not a failure: it is reported through
      // `resumed`, and the host can retry on the next gesture.
      resuming.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, RESUME_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return { context, resumed: context.state === 'running' };
}

export interface BrowserSupport {
  readonly audioContext: boolean;
  readonly webSocket: boolean;
  readonly atob: boolean;
}

export function detectSupport(): BrowserSupport {
  return {
    audioContext: typeof AudioContext === 'function',
    webSocket: typeof WebSocket === 'function',
    atob: typeof atob === 'function'
  };
}
