// Compose a GAS session, the renderer and a playback engine for a browser page.
// The one module that imports the concrete renderer. It never imports a
// connector: the host builds one and passes it in, along with its settings.
import { createSession, type GasSession } from '@luna-estelar/gas-api';
import type {
  Connector,
  ConnectorSettings,
  MusicalPosition,
  Renderer
} from '@luna-estelar/gas-protocol';
import { createRenderer, type CreateRendererOptions } from '@luna-estelar/gas-renderer';
import { ChainedSourceEngine } from './audio/chained-source-engine.js';
import { AudioClock } from './audio/clock.js';
import { openAudioContext } from './audio/context.js';
import type { EngineOptions, PlaybackEngine } from './audio/engine.js';
import { PcmCapture } from './capture.js';

export const version = '0.2.0';

export interface BrowserSessionOptions {
  /**
   * The connector, or a factory for one. A connector opens once, so only a
   * factory lets `session.retryRenderer()` build a working replacement.
   */
  readonly connector: Connector | (() => Connector);
  readonly settings: ConnectorSettings;
  /** Adopted as is and never closed by the session. Omitted, the session opens one and owns it. */
  readonly context?: AudioContext;
  /** Defaults to one chunk duration of the connector's model. Clamped to 0.25-4 s. */
  readonly prebufferSeconds?: number;
  /** Record each run so it can be offered as a WAV download. Off by default. */
  readonly capture?: boolean;
  readonly engine?: (context: AudioContext, options: EngineOptions) => PlaybackEngine;
  readonly renderer?: Omit<CreateRendererOptions, 'clock' | 'connector' | 'settings'>;
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
  const supplied = options.connector;
  const makeConnector = typeof supplied === 'function' ? supplied : () => supplied;
  // Created before the first await, so a context opened here resumes inside the
  // host's gesture.
  const opening = options.context === undefined ? openAudioContext() : undefined;
  let context: AudioContext | undefined = options.context;
  let clock: AudioClock | undefined;
  let engine: PlaybackEngine | undefined;
  try {
    if (opening !== undefined) context = (await opening).context;
    const audioContext = context!;
    const firstConnector = makeConnector();
    const description = await firstConnector.describe();
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

    // The session replaces its renderer on retry, so the playhead must ask
    // whichever one it built last.
    let unusedConnector: Connector | undefined = firstConnector;
    let renderer: Renderer | undefined;
    const rendererClock = clock;
    const session = await createSession({
      createRenderer: async () => {
        const connector = unusedConnector ?? makeConnector();
        unusedConnector = undefined;
        renderer = await createRenderer({
          ...options.renderer,
          clock: rendererClock,
          connector,
          settings: options.settings
        });
        return renderer;
      }
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
        const position = renderer?.positionAtSeconds?.(seconds);
        return position === undefined ? undefined : { position, seconds };
      },
      async close() {
        unsubscribe();
        try {
          await session.close();
        } finally {
          await activeEngine.close();
          rendererClock.dispose();
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
 * Drive the engine from the session. Audio alone is not enough: a host stop and
 * a renderer failure must silence what is already scheduled, while a finished
 * piece must play out the tail the listener has not heard yet.
 *
 * The renderer ends a finite piece with `stopping`, a `stopped` status flagged
 * `completed`, and a plain `stopped`. A host stop and a failure give `stopping`
 * and then `stopped` or `failed`, with no flag. `stopping` looks the same both
 * ways and arrives while the listener is still up to a prebuffer behind, so the
 * engine acts only once the outcome is known.
 */
function wireEngine(session: GasSession, engine: PlaybackEngine): () => void {
  let completing = false;
  const unsubscribers = [
    session.on('audio', (chunk) => engine.push(chunk)),
    session.on('lifecycle', (event) => {
      if (event.completed === true) {
        completing = true;
        return;
      }
      if (event.rendererPlayback !== 'stopped' && event.rendererPlayback !== 'failed') return;
      if (completing) {
        completing = false;
        return;
      }
      engine.flush();
    }),
    session.on('error', (error) => {
      if (error.kind === 'renderer') engine.flush();
    })
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
