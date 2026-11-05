// Compose a GAS session and a playback engine for a browser page. It never
// imports a connector: the app builds one and passes it in.
import { createSession, type GasSession } from '../api/index.js';
import type { Connector, ConnectorConfig, MusicalPosition } from '../protocol/index.js';
import { ChainedSourceEngine } from './audio/chained-source-engine.js';
import { AudioClock } from './audio/clock.js';
import { openAudioContext } from './audio/context.js';
import type { EngineOptions, PlaybackEngine } from './audio/engine.js';
import { PcmCapture } from './capture.js';

export interface BrowserSessionOptions {
  readonly connector: Connector;
  /** A patch over the connector's `defaultConfig`. */
  readonly connectorConfig?: ConnectorConfig;
  /** Adopted as is and never closed by the session. Omitted, the session opens one and owns it. */
  readonly context?: AudioContext;
  /** Defaults to one chunk duration of the connector's model. Clamped to 0.25-4 s. */
  readonly prebufferSeconds?: number;
  /** Record each Play so it can be offered as a WAV download. Off by default. */
  readonly capture?: boolean;
  readonly engine?: (context: AudioContext, options: EngineOptions) => PlaybackEngine;
  /** @internal How long a playing track may go without audio. For tests. */
  readonly firstAudioTimeoutSeconds?: number;
}

export interface BrowserSession {
  readonly session: GasSession;
  readonly audio: PlaybackEngine;
  readonly capture: PcmCapture | undefined;
  /**
   * The context the audio graph runs on, adopted or opened here. Exposed because
   * a browser may hand back a context it declined to start: read `state`, listen
   * for `statechange`, and call `resume()` from a later gesture. Closing it is the
   * owner's business — `close()` closes only a context this session opened.
   */
  readonly context: AudioContext;
  /** The musical position the listener is hearing now, or undefined before first audio. */
  audiblePosition(): { position: MusicalPosition; seconds: number } | undefined;
  close(): Promise<void>;
}

export async function createBrowserSession(
  options: BrowserSessionOptions
): Promise<BrowserSession> {
  // Created before the first await, so a context opened here resumes inside the
  // app's gesture.
  const opening = options.context === undefined ? openAudioContext() : undefined;
  let context: AudioContext | undefined = options.context;
  let clock: AudioClock | undefined;
  let engine: PlaybackEngine | undefined;
  try {
    if (opening !== undefined) context = (await opening).context;
    const audioContext = context!;
    const description = options.connector.description;
    clock = new AudioClock(audioContext);
    const capture = options.capture === true ? new PcmCapture() : undefined;
    const engineOptions: EngineOptions = {
      prebufferSeconds: options.prebufferSeconds ?? description.model.chunkDurationSeconds,
      clock,
      ...(capture !== undefined ? { capture } : {})
    };
    engine = (options.engine ?? ((ctx, opts) => new ChainedSourceEngine(ctx, opts)))(
      audioContext,
      engineOptions
    );

    const audioClock = clock;
    const session = await createSession({
      connector: options.connector,
      clock: audioClock,
      ...(options.connectorConfig !== undefined
        ? { connectorConfig: options.connectorConfig }
        : {}),
      ...(options.firstAudioTimeoutSeconds !== undefined
        ? { firstAudioTimeoutSeconds: options.firstAudioTimeoutSeconds }
        : {})
    });

    const activeEngine = engine;
    const unsubscribe = wireEngine(session, activeEngine);
    return {
      session,
      audio: activeEngine,
      capture,
      context: audioContext,
      audiblePosition() {
        const seconds = activeEngine.playheadSeconds();
        if (seconds === undefined) return undefined;
        const position = session.positionAtSeconds(seconds);
        return position === undefined ? undefined : { position, seconds };
      },
      async close() {
        // Silence first, so the listener hears nothing more.
        activeEngine.flush();
        unsubscribe();
        try {
          await session.close();
        } finally {
          await activeEngine.close();
          audioClock.dispose();
          if (opening !== undefined) await audioContext.close().catch(() => undefined);
        }
      }
    };
  } catch (error) {
    // Never leave audio running, or a context this call opened, behind a failed start.
    await engine?.close().catch(() => undefined);
    clock?.dispose();
    if (opening !== undefined && context !== undefined) {
      await context.close().catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Drive the engine from the session. Audio alone is not enough: Stop and a
 * failure must silence what is already scheduled, while a finished piece plays
 * out the tail the listener has not heard yet.
 */
function wireEngine(session: GasSession, engine: PlaybackEngine): () => void {
  const unsubscribers = [
    session.on('audio', (chunk) => engine.push(chunk)),
    session.on('state', (state) => {
      if (state.status !== 'stopped' && state.status !== 'closed') return;
      if (state.ended === 'stopped' || state.ended === 'failed') engine.flush();
    })
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
