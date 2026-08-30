// Compose the browser renderer and Lyria connector. Import lazily when starting audio.
import { createSession, type GasSession } from '@luna-estelar/gas-api';
import { createLyriaConnector } from '@luna-estelar/gas-connector-lyria';
import { createRenderer } from '@luna-estelar/gas-renderer';
import { accessSettings, type Access } from './access.js';
import { PcmCapture } from './audio.js';
import { AudioContextClock, PcmPlayback } from './playback.js';

export interface BrowserSessionOptions {
  /** BYOK or hosted — one path, chosen by the caller, invisible to the surface. */
  readonly access: Access;
  /** Record each run so it can be offered as a WAV download. Off by default. */
  readonly capture?: boolean;
  /** Injectable so tests can drive a fake context instead of a real device. */
  readonly createContext?: () => AudioContext;
}

export interface BrowserSession {
  readonly session: GasSession;
  readonly playback: PcmPlayback;
  /** Present only when `capture` was requested. */
  readonly capture: PcmCapture | undefined;
  close(): Promise<void>;
}

export async function createBrowserSession(
  options: BrowserSessionOptions
): Promise<BrowserSession> {
  const context = (options.createContext ?? (() => new AudioContext()))();
  let playback: PcmPlayback | undefined;
  try {
    await context.resume();
    const capture = options.capture === true ? new PcmCapture() : undefined;
    const clock = new AudioContextClock(context);
    playback = new PcmPlayback(context, capture);
    const session = await createSession({
      createRenderer: async () =>
        createRenderer({
          clock,
          connector: createLyriaConnector(),
          settings: accessSettings(options.access)
        })
    });
    const activePlayback = playback;
    const unsubscribe = session.on('audio', (chunk) => activePlayback.push(chunk));
    return {
      session,
      playback: activePlayback,
      capture,
      async close() {
        unsubscribe();
        await session.close();
        await activePlayback.close();
      }
    };
  } catch (error) {
    // Never leave an AudioContext open behind a failed start.
    if (playback !== undefined) await playback.close().catch(() => undefined);
    else await context.close().catch(() => undefined);
    throw error;
  }
}
