// The Lyria RealTime transport: one socket, its setup, its audio and how it
// closes. It knows nothing about GAS state, so a connector variant can reuse it
// with its own translation.

import { GoogleGenAI } from '@google/genai';
import type { LiveMusicGenerationConfig } from '@google/genai';
import type {
  ClockTimer,
  ConnectorAudioChunk,
  ConnectorError,
  MonotonicClock
} from '@luna-estelar/gas/protocol';
import {
  LYRIA_RT_API_VERSION,
  LYRIA_RT_MODEL_ID,
  PCM_BYTES_PER_FRAME,
  PCM_BYTES_PER_SECOND,
  PCM_CHANNELS,
  PCM_SAMPLE_RATE
} from './constants.js';
import { cancelledStart, connectorError, hostCall, safeError } from './errors.js';
import type { WeightedPrompt } from './prompts.js';
import type { LyriaRtScale } from './scale.js';

type LyriaRtClientOptions = {
  readonly apiKey: string;
  readonly apiVersion: typeof LYRIA_RT_API_VERSION;
  readonly httpOptions?: { readonly baseUrl: string };
};

type LyriaRtAudioChunk = { readonly data?: string };

type LyriaRtServerMessage = {
  readonly setupComplete?: unknown;
  readonly serverContent?: { readonly audioChunks?: readonly LyriaRtAudioChunk[] };
  readonly filteredPrompt?: unknown;
  readonly warning?: unknown;
};

type LyriaRtCallbacks = {
  readonly onmessage: (message: LyriaRtServerMessage) => void;
  readonly onerror: () => void;
  readonly onclose: (event: { readonly code?: number }) => void;
};

/** The generation settings Lyria RealTime takes, as the transport sends them. */
export type LyriaRtMusicGenerationConfig = {
  readonly temperature: number;
  readonly guidance: number;
  readonly topK: number;
  readonly musicGenerationMode: 'QUALITY' | 'DIVERSITY';
  readonly bpm: number;
  readonly scale?: LyriaRtScale;
  readonly muteBass?: boolean;
  readonly muteDrums?: boolean;
  readonly onlyBassAndDrums?: boolean;
  readonly seed?: number;
  readonly density?: number;
  readonly brightness?: number;
};

/** The SDK's music session, narrowed to what the transport uses. */
export interface LyriaRtMusicSession {
  setWeightedPrompts(params: {
    readonly weightedPrompts: Array<{ readonly text: string; readonly weight: number }>;
  }): Promise<void>;
  setMusicGenerationConfig(params: {
    readonly musicGenerationConfig: LyriaRtMusicGenerationConfig;
  }): Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  resetContext(): void;
  close(): void;
}

export interface LyriaRtSdkClient {
  connect(params: {
    readonly model: string;
    readonly callbacks: LyriaRtCallbacks;
  }): Promise<LyriaRtMusicSession>;
}

export interface LyriaRtConnectorDependencies {
  readonly clock: MonotonicClock;
  readonly setupTimeoutSeconds: number;
  readonly createClient: (options: LyriaRtClientOptions) => LyriaRtSdkClient;
}

export type LyriaRtTransportWarningCode = 'lyria-rt-prompt-filtered' | 'lyria-rt-provider-warning';

export interface LyriaRtSessionOptions {
  readonly apiKey: string;
  /** An HTTPS origin that speaks the Lyria RealTime WebSocket protocol. Google's own by default. */
  readonly endpoint?: string;
  /** Aborting it before setup completes rejects with `lyria-rt-start-cancelled`. */
  readonly signal?: AbortSignal;
  onAudio(chunk: ConnectorAudioChunk): void;
  onWarning(code: LyriaRtTransportWarningCode): void;
  /**
   * Called once, for a close after setup that the session didn't ask for:
   * the server closed, the socket failed, or the audio was malformed.
   */
  onClose(error: ConnectorError): void;
}

/** One open Lyria RealTime socket, after setup. Every method does nothing once it is closed. */
export interface LyriaRtSession {
  setWeightedPrompts(prompts: readonly WeightedPrompt[]): Promise<void>;
  setMusicGenerationConfig(config: LyriaRtMusicGenerationConfig): Promise<void>;
  play(): void;
  pause(): void;
  resetContext(): void;
  /** Sends stop, closes the socket, and resolves when the socket has closed. */
  close(): Promise<void>;
}

class SystemClock implements MonotonicClock {
  now(): number {
    return performance.now() / 1000;
  }

  schedule(deadlineSeconds: number, callback: () => void): ClockTimer {
    const token = setTimeout(callback, Math.max(0, deadlineSeconds * 1000 - performance.now()));
    return { token };
  }

  cancel(timer: ClockTimer): void {
    clearTimeout(timer.token as ReturnType<typeof setTimeout>);
  }
}

export const DEFAULT_DEPENDENCIES: LyriaRtConnectorDependencies = {
  clock: new SystemClock(),
  setupTimeoutSeconds: 15,
  createClient: (options) => {
    const client = new GoogleGenAI(options);
    return {
      connect: async ({ model, callbacks }) => {
        const session = await client.live.music.connect({
          model,
          callbacks: {
            onmessage: (message) => callbacks.onmessage(message),
            onerror: () => callbacks.onerror(),
            onclose: (event) => callbacks.onclose(event)
          }
        });
        return {
          setWeightedPrompts: (params) => session.setWeightedPrompts(params),
          setMusicGenerationConfig: (params) =>
            session.setMusicGenerationConfig({
              musicGenerationConfig: params.musicGenerationConfig as LiveMusicGenerationConfig
            }),
          play: () => session.play(),
          pause: () => session.pause(),
          stop: () => session.stop(),
          resetContext: () => session.resetContext(),
          close: () => session.close()
        };
      }
    };
  }
};

function decodeBase64Pcm(data: unknown): Uint8Array {
  if (
    typeof data !== 'string' ||
    data.length === 0 ||
    data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
  ) {
    throw connectorError('lyria-rt-malformed-audio', 'provider', true);
  }
  const atobFunction = (globalThis as { atob?: (input: string) => string }).atob;
  if (atobFunction === undefined) {
    throw connectorError('lyria-rt-audio-decoder-unavailable', 'internal', false);
  }
  let binary: string;
  try {
    binary = atobFunction(data);
  } catch {
    throw connectorError('lyria-rt-malformed-audio', 'provider', true);
  }
  if (binary.length === 0 || binary.length % PCM_BYTES_PER_FRAME !== 0) {
    throw connectorError('lyria-rt-malformed-audio', 'provider', true);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Classify only the standard close codes, and pass the raw number through as
 * `closeCode` regardless. An application code (4000-4999) belongs to whoever
 * is serving the endpoint, so it is reported as a network failure and left for
 * the host to interpret rather than guessed at here.
 */
function classifyClose(code: number | undefined, beforeSetup: boolean): ConnectorError {
  // Google closes with 1007 for a malformed key and 1008 for a rejected one,
  // both before setup completes. After setup the same codes are transport
  // noise, not an authentication verdict.
  if (beforeSetup && (code === 1007 || code === 1008)) {
    return connectorError('lyria-rt-auth-rejected', 'auth', false, code);
  }
  if (code === 1002 || code === 1011) {
    return connectorError('lyria-rt-provider-failure', 'provider', true, code);
  }
  return connectorError('lyria-rt-network-failure', 'network', true, code);
}

function networkFailure(error: unknown): ConnectorError {
  return safeError(error, connectorError('lyria-rt-network-failure', 'network', true));
}

function closeQuietly(session: LyriaRtMusicSession | undefined, sendStop = false): void {
  if (session === undefined) return;
  try {
    if (sendStop) session.stop();
  } catch {
    // Stop and close are best effort and never expose SDK details.
  }
  try {
    session.close();
  } catch {
    // As above.
  }
}

/**
 * Opens a Lyria RealTime socket and resolves once setup completes. Rejects with
 * a `ConnectorError` for a close before setup, the setup timeout or the abort.
 */
export function openLyriaRtSession(options: LyriaRtSessionOptions): Promise<LyriaRtSession> {
  return openLyriaRtSessionWithDependencies(options, DEFAULT_DEPENDENCIES);
}

/** @internal The test seam. */
export function openLyriaRtSessionWithDependencies(
  options: LyriaRtSessionOptions,
  dependencies: LyriaRtConnectorDependencies
): Promise<LyriaRtSession> {
  const { clock, setupTimeoutSeconds, createClient } = dependencies;
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(cancelledStart());

  // 'starting' until setup completes and the session is in hand; 'open' after;
  // 'closing' once the session asked to close or failed, until the close event;
  // 'closed' after it.
  let phase: 'starting' | 'open' | 'closing' | 'closed' = 'starting';
  let sdkSession: LyriaRtMusicSession | undefined;
  let setupReceived = false;
  let closed: () => void = () => undefined;
  const closedPromise = new Promise<void>((resolve) => {
    closed = resolve;
  });

  return new Promise<LyriaRtSession>((resolve, reject) => {
    const settle = (): void => {
      clock.cancel(setupTimer);
      signal?.removeEventListener('abort', onAbort);
    };

    // A startup failure: closes whatever is open, and a session that lands
    // later is closed on arrival.
    const failStartup = (error: ConnectorError): void => {
      if (phase !== 'starting') return;
      phase = 'closed';
      settle();
      closeQuietly(sdkSession);
      closed();
      reject(error);
    };

    // A failure after setup that the session didn't ask for. Reported at once,
    // but `close()` still resolves only on the close event.
    const failOpen = (error: ConnectorError): void => {
      if (phase !== 'open') return;
      phase = 'closing';
      closeQuietly(sdkSession);
      hostCall(() => options.onClose(error));
    };

    const fail = (error: ConnectorError): void => {
      if (phase === 'starting') failStartup(error);
      else failOpen(error);
    };

    const maybeOpen = (): void => {
      if (phase !== 'starting' || sdkSession === undefined || !setupReceived) return;
      phase = 'open';
      settle();
      resolve(session);
    };

    const onAbort = (): void => failStartup(cancelledStart());

    const handleMessage = (message: LyriaRtServerMessage): void => {
      if (phase === 'closing' || phase === 'closed') return;
      if (message.setupComplete !== undefined && !setupReceived) {
        setupReceived = true;
        maybeOpen();
      }
      if (message.filteredPrompt !== undefined) {
        hostCall(() => options.onWarning('lyria-rt-prompt-filtered'));
      }
      if (message.warning !== undefined) {
        hostCall(() => options.onWarning('lyria-rt-provider-warning'));
      }
      // Audio is the session's only once it is open, and stops when it closes.
      if (phase !== 'open') return;
      try {
        for (const chunk of message.serverContent?.audioChunks ?? []) {
          const bytes = decodeBase64Pcm(chunk.data);
          hostCall(() =>
            options.onAudio({
              bytes,
              codec: 'pcm',
              sampleFormat: 's16le',
              sampleRate: PCM_SAMPLE_RATE,
              channels: PCM_CHANNELS,
              durationSeconds: bytes.length / PCM_BYTES_PER_SECOND
            })
          );
        }
      } catch (error) {
        fail(safeError(error, connectorError('lyria-rt-internal-failure', 'internal', false)));
      }
    };

    const handleClose = (code: number | undefined): void => {
      if (phase === 'closing') {
        phase = 'closed';
        closed();
        return;
      }
      fail(classifyClose(code, !setupReceived));
    };

    const setupTimer = clock.schedule(clock.now() + setupTimeoutSeconds, () =>
      failStartup(connectorError('lyria-rt-setup-timeout', 'network', true))
    );
    signal?.addEventListener('abort', onAbort, { once: true });

    const guarded = <T>(action: (sdk: LyriaRtMusicSession) => T, idle: T): T => {
      if (phase !== 'open' || sdkSession === undefined) return idle;
      try {
        return action(sdkSession);
      } catch (error) {
        throw networkFailure(error);
      }
    };

    const session: LyriaRtSession = {
      setWeightedPrompts: async (prompts) => {
        const sent = guarded(
          (sdk) =>
            sdk.setWeightedPrompts({
              weightedPrompts: prompts.map(({ text, weight }) => ({ text, weight }))
            }),
          undefined
        );
        try {
          await sent;
        } catch (error) {
          throw networkFailure(error);
        }
      },
      setMusicGenerationConfig: async (musicGenerationConfig) => {
        const sent = guarded(
          (sdk) => sdk.setMusicGenerationConfig({ musicGenerationConfig }),
          undefined
        );
        try {
          await sent;
        } catch (error) {
          throw networkFailure(error);
        }
      },
      play: () => guarded((sdk) => sdk.play(), undefined),
      pause: () => guarded((sdk) => sdk.pause(), undefined),
      resetContext: () => guarded((sdk) => sdk.resetContext(), undefined),
      close: () => {
        if (phase === 'open') {
          phase = 'closing';
          closeQuietly(sdkSession, true);
        }
        return closedPromise;
      }
    };

    let client: LyriaRtSdkClient;
    try {
      client = createClient({
        apiKey: options.apiKey,
        apiVersion: LYRIA_RT_API_VERSION,
        ...(options.endpoint !== undefined ? { httpOptions: { baseUrl: options.endpoint } } : {})
      });
    } catch {
      failStartup(connectorError('lyria-rt-startup-failure', 'internal', false));
      return;
    }

    // The SDK cannot cancel a connect in flight, so a session that lands after
    // startup failed is closed on arrival.
    client
      .connect({
        model: LYRIA_RT_MODEL_ID,
        callbacks: {
          onmessage: handleMessage,
          // ws and browsers always follow an error with a close, and only the
          // close carries the code that classifies it.
          onerror: () => undefined,
          onclose: (event) => handleClose(event.code)
        }
      })
      .then(
        (arrived) => {
          if (phase !== 'starting') {
            closeQuietly(arrived);
            return;
          }
          sdkSession = arrived;
          maybeOpen();
        },
        () => failStartup(connectorError('lyria-rt-network-failure', 'network', true))
      );
  });
}
