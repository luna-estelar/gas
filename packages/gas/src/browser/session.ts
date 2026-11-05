// Compose a GAS session and a playback engine for a browser page. It never
// imports a connector: the app builds one and passes it in.
import { createSession, type GasSession } from '../api/index.js';
import type { Connector, ConnectorConfig, DocumentDefaults } from '../protocol/index.js';
import { AudiblePositions } from './audible.js';
import { ChainedSourceEngine } from './audio/chained-source-engine.js';
import { AudioClock } from './audio/clock.js';
import { openAudioContext } from './audio/context.js';
import type { EngineOptions, PlaybackEngine } from './audio/engine.js';
import { PcmCapture } from './capture.js';

export interface BrowserSessionOptions {
  readonly connector: Connector;
  /** A patch over the connector's `defaultConfig`. */
  readonly connectorConfig?: ConnectorConfig;
  /** The tempo, time signature and key for a document that doesn't set them. */
  readonly documentDefaults?: DocumentDefaults;
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
      ...(options.documentDefaults !== undefined
        ? { documentDefaults: options.documentDefaults }
        : {}),
      ...(options.firstAudioTimeoutSeconds !== undefined
        ? { firstAudioTimeoutSeconds: options.firstAudioTimeoutSeconds }
        : {})
    });

    const activeEngine = engine;
    const unsubscribe = wireEngine(session, activeEngine, audioClock);
    return {
      session,
      audio: activeEngine,
      capture,
      context: audioContext,
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
 * out the tail the listener has not heard yet. Audible positions follow the
 * same rule.
 */
function wireEngine(session: GasSession, engine: PlaybackEngine, clock: AudioClock): () => void {
  const audible = new AudiblePositions(
    engine,
    clock,
    (seconds) => session.positionAtSeconds(seconds),
    (event) => session.emitAudiblePosition(event)
  );
  const unsubscribers = [
    session.on('audio', (chunk) => engine.push(chunk)),
    session.on('generationPosition', (event) => audible.push(event)),
    session.on('state', (state) => {
      if (state.status === 'starting') {
        audible.reset();
        return;
      }
      if (state.status !== 'stopped' && state.status !== 'closed') return;
      if (state.ended === 'stopped' || state.ended === 'failed') {
        // Before the flush, so nothing unheard is reported as it stops.
        audible.reset();
        engine.flush();
      }
    })
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    audible.dispose();
  };
}
