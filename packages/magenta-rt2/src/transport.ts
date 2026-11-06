// The bridge transport: one WebSocket, its greeting, its commands and acks, its
// audio and how it closes. It knows nothing about GAS state, so a connector
// variant can reuse it with its own translation.

import type {
  ClockTimer,
  ConnectorAudioChunk,
  ConnectorError,
  MonotonicClock
} from '@luna-estelar/gas/protocol';
import { cancelledStart, connectorError, hostCall } from './errors.js';
import { MAX_PROMPTS, type WeightedPrompt } from './prompts.js';
import {
  CHANNELS,
  PROTOCOL_VERSION,
  SAMPLE_RATE,
  decodeAudioPacket,
  parseServerMessage,
  type ClientMessage,
  type ServerHello
} from './protocol.js';
import { validateEndpoint } from './settings.js';

/**
 * The slice of the WebSocket API the transport uses, so tests can drive it and
 * Node 22+ and browsers can both supply their global `WebSocket`.
 */
export interface BridgeSocket {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface MagentaRt2Dependencies {
  readonly clock: MonotonicClock;
  readonly createSocket: (url: string) => BridgeSocket;
}

/** Wait this long between attempts when the bridge says another session is active. */
const BUSY_RETRY_SECONDS = 0.1;
/** A command the bridge never answers fails the session after this long. */
const COMMAND_TIMEOUT_SECONDS = 20;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 20;

export interface MagentaRt2SessionOptions {
  /** `ws://` for a loopback bridge, otherwise `wss://`. */
  readonly endpoint: string;
  readonly token?: string;
  /** Aborting it before the hellos are exchanged rejects with `magenta-rt2-start-cancelled`. */
  readonly signal?: AbortSignal;
  /** How long to connect and greet, busy retries included. Defaults to 20 s. */
  readonly connectTimeoutSeconds?: number;
  onAudio(chunk: ConnectorAudioChunk): void;
  /**
   * Called once, for an end after the greeting that the session didn't ask for:
   * the bridge closed or refused, the socket failed, or a command timed out.
   */
  onClose(error: ConnectorError): void;
}

export interface MagentaRt2Generation {
  readonly temperature?: number;
  readonly topK?: number;
}

/**
 * One greeted bridge socket. Each command resolves on the bridge's ack and
 * rejects with its error. Every command does nothing once the session is closed.
 */
export interface MagentaRt2Session {
  /** Optional commands the bridge accepts, from its hello. */
  readonly controls: readonly string[];
  start(prompts: readonly WeightedPrompt[], generation?: MagentaRt2Generation): Promise<void>;
  style(prompts: readonly WeightedPrompt[]): Promise<void>;
  pause(paused: boolean): Promise<void>;
  /** Resets the bridge's idle timer while no generation is started. */
  keepalive(): Promise<void>;
  /** Closes the socket, which ends the bridge session, and resolves once it has closed. */
  close(): Promise<void>;
}

const protocolViolation = (closeCode?: number) =>
  connectorError('magenta-rt2-protocol-violation', 'provider', false, closeCode);
const networkFailure = (closeCode?: number) =>
  connectorError('magenta-rt2-network-failure', 'network', true, closeCode);

/** An error the bridge sends, with or without a command id. */
function bridgeError(code: string, retryable: boolean): ConnectorError {
  switch (code) {
    case 'unauthorized':
    case 'forbidden-origin':
      return connectorError('magenta-rt2-auth-rejected', 'auth', false);
    case 'busy':
      return connectorError('magenta-rt2-busy', 'provider', true);
    case 'unsupported-protocol':
      return protocolViolation();
    case 'prompt-encode-failed':
      return connectorError('magenta-rt2-prompt-encode-failed', 'provider', retryable);
    case 'engine-failure':
      return connectorError('magenta-rt2-engine-failure', 'provider', retryable);
    default:
      return connectorError('magenta-rt2-command-rejected', 'internal', false);
  }
}

/**
 * The bridge's close codes (PROTOCOL.md). The raw number goes through as
 * `closeCode` either way.
 */
export function classifyClose(code: number | undefined): ConnectorError {
  switch (code) {
    case 4401:
    case 4403:
      return connectorError('magenta-rt2-auth-rejected', 'auth', false, code);
    case 4400:
      return protocolViolation(code);
    case 4409:
      return connectorError('magenta-rt2-busy', 'provider', true, code);
    case 4500:
      return connectorError('magenta-rt2-engine-failure', 'provider', true, code);
    case 4408:
      return connectorError('magenta-rt2-idle-timeout', 'network', true, code);
    default:
      return networkFailure(code);
  }
}

function compatible(hello: ServerHello): boolean {
  return (
    hello.protocol === PROTOCOL_VERSION &&
    hello.encoding === 'pcm_s16le' &&
    hello.sampleRate === SAMPLE_RATE &&
    hello.channels === CHANNELS &&
    hello.maxPrompts >= MAX_PROMPTS
  );
}

function detach(socket: BridgeSocket): void {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
  try {
    socket.close(1000);
  } catch {
    // Already closed.
  }
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

function globalSocket(url: string): BridgeSocket {
  const WebSocketClass = (globalThis as { WebSocket?: new (url: string) => BridgeSocket })
    .WebSocket;
  if (WebSocketClass === undefined) {
    throw connectorError('magenta-rt2-websocket-unavailable', 'internal', false);
  }
  return new WebSocketClass(url);
}

export const DEFAULT_DEPENDENCIES: MagentaRt2Dependencies = {
  clock: new SystemClock(),
  createSocket: globalSocket
};

/**
 * Connects to a bridge and resolves once the hellos are exchanged, retrying
 * while the bridge is busy. Rejects with a `ConnectorError` for a refusal, a
 * close, the connect timeout or the abort.
 */
export function openMagentaRt2Session(
  options: MagentaRt2SessionOptions
): Promise<MagentaRt2Session> {
  return openMagentaRt2SessionWithDependencies(options, DEFAULT_DEPENDENCIES);
}

interface Pending {
  resolve(): void;
  reject(error: ConnectorError): void;
  readonly timer: ClockTimer;
}

/** @internal The test seam. */
export function openMagentaRt2SessionWithDependencies(
  options: MagentaRt2SessionOptions,
  dependencies: MagentaRt2Dependencies
): Promise<MagentaRt2Session> {
  const { clock, createSocket } = dependencies;
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(cancelledStart());
  let endpoint: string;
  try {
    endpoint = validateEndpoint(options.endpoint);
  } catch (error) {
    return Promise.reject(error);
  }

  // 'starting' until the hellos are exchanged; 'open' after; 'closing' once the
  // session asked to close or failed, until the close event; 'closed' after it.
  let phase: 'starting' | 'open' | 'closing' | 'closed' = 'starting';
  let socket: BridgeSocket | undefined;
  let controls: readonly string[] = [];
  let nextId = 1;
  let lastRefusedBusy = false;
  const pending = new Map<number, Pending>();
  let closed: () => void = () => undefined;
  const closedPromise = new Promise<void>((resolve) => {
    closed = resolve;
  });

  return new Promise<MagentaRt2Session>((resolve, reject) => {
    let retryTimer: ClockTimer | undefined;

    const settleStartup = (): void => {
      clock.cancel(deadline);
      if (retryTimer !== undefined) clock.cancel(retryTimer);
      signal?.removeEventListener('abort', onAbort);
    };

    const dropSocket = (): void => {
      const current = socket;
      socket = undefined;
      if (current !== undefined) detach(current);
    };

    /** Settles every command still waiting. A deliberate close resolves them. */
    const settlePending = (error?: ConnectorError): void => {
      for (const entry of pending.values()) {
        clock.cancel(entry.timer);
        if (error === undefined) entry.resolve();
        else entry.reject(error);
      }
      pending.clear();
    };

    /** Stops reading the socket and closes it; the close event settles `close()`. */
    const shutDown = (): void => {
      if (socket === undefined) return;
      socket.onmessage = null;
      try {
        socket.close(1000);
      } catch {
        // Already closed.
      }
    };

    const failStartup = (error: ConnectorError): void => {
      if (phase !== 'starting') return;
      phase = 'closed';
      settleStartup();
      dropSocket();
      closed();
      reject(error);
    };

    const failOpen = (error: ConnectorError): void => {
      if (phase !== 'open') return;
      phase = 'closing';
      settlePending(error);
      shutDown();
      hostCall(() => options.onClose(error));
    };

    const fail = (error: ConnectorError): void => {
      if (phase === 'starting') failStartup(error);
      else failOpen(error);
    };

    const onAbort = (): void => failStartup(cancelledStart());

    // The previous session on this bridge, often this connector's own last
    // connection, may still be releasing. Try again shortly, within the deadline.
    const retryBusy = (): void => {
      lastRefusedBusy = true;
      dropSocket();
      retryTimer = clock.schedule(clock.now() + BUSY_RETRY_SECONDS, () => {
        retryTimer = undefined;
        if (phase === 'starting') connect();
      });
    };

    const handleText = (text: string): void => {
      const message = parseServerMessage(text);
      if (message === undefined) {
        fail(protocolViolation());
        return;
      }
      if (message.type === 'hello') {
        if (phase !== 'starting') {
          fail(protocolViolation());
          return;
        }
        if (!compatible(message)) {
          failStartup(protocolViolation());
          return;
        }
        controls = message.controls;
        phase = 'open';
        settleStartup();
        resolve(session);
        return;
      }
      if (message.type === 'ack') {
        const entry = pending.get(message.id);
        if (entry === undefined) return;
        pending.delete(message.id);
        clock.cancel(entry.timer);
        entry.resolve();
        return;
      }
      if (phase === 'starting') {
        // A refusal of the hello; its close follows.
        if (message.code === 'busy') retryBusy();
        else failStartup(bridgeError(message.code, message.retryable));
        return;
      }
      const failure = bridgeError(message.code, message.retryable);
      // An error answering a command fails that command. One without an id is
      // the bridge ending the session, and its close follows.
      if (message.id === undefined) {
        failOpen(failure);
        return;
      }
      const entry = pending.get(message.id);
      if (entry === undefined) return;
      pending.delete(message.id);
      clock.cancel(entry.timer);
      entry.reject(failure);
    };

    const handleAudio = (data: ArrayBuffer): void => {
      if (phase !== 'open') return;
      const packet = decodeAudioPacket(data);
      if (packet === undefined) {
        failOpen(protocolViolation());
        return;
      }
      hostCall(() =>
        options.onAudio({
          bytes: packet.pcm,
          codec: 'pcm',
          sampleFormat: 's16le',
          sampleRate: SAMPLE_RATE,
          channels: CHANNELS,
          durationSeconds: packet.frames / SAMPLE_RATE
        })
      );
    };

    const handleClose = (code: number): void => {
      if (phase === 'starting' || phase === 'open') fail(classifyClose(code));
      if (phase !== 'closed') {
        phase = 'closed';
        closed();
      }
    };

    const connect = (): void => {
      let current: BridgeSocket;
      try {
        current = createSocket(endpoint);
      } catch {
        failStartup(networkFailure());
        return;
      }
      socket = current;
      current.binaryType = 'arraybuffer';
      current.onopen = () => {
        try {
          current.send(
            JSON.stringify({
              type: 'hello',
              protocol: PROTOCOL_VERSION,
              ...(options.token !== undefined ? { token: options.token } : {})
            } satisfies ClientMessage)
          );
        } catch {
          failStartup(networkFailure());
        }
      };
      current.onmessage = (event) => {
        if (typeof event.data === 'string') handleText(event.data);
        else if (event.data instanceof ArrayBuffer) handleAudio(event.data);
        else fail(protocolViolation());
      };
      // A WebSocket always reports a close after an error, and only the close
      // carries a code, so the error event itself is ignored.
      current.onerror = () => undefined;
      current.onclose = (event) => handleClose(event.code);
    };

    const command = (message: Exclude<ClientMessage, { readonly type: 'hello' }>) => {
      if (phase !== 'open' || socket === undefined) return Promise.resolve();
      const id = nextId++;
      const target = socket;
      return new Promise<void>((resolveCommand, rejectCommand) => {
        const timer = clock.schedule(clock.now() + COMMAND_TIMEOUT_SECONDS, () => {
          pending.delete(id);
          const error = connectorError('magenta-rt2-command-timeout', 'network', true);
          rejectCommand(error);
          failOpen(error);
        });
        pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer });
        try {
          target.send(JSON.stringify({ ...message, id }));
        } catch {
          failOpen(networkFailure());
        }
      });
    };

    const session: MagentaRt2Session = {
      get controls() {
        return controls;
      },
      start: (prompts, generation = {}) =>
        command({
          type: 'start',
          id: 0,
          prompts,
          ...(generation.temperature !== undefined ? { temperature: generation.temperature } : {}),
          ...(generation.topK !== undefined ? { topK: generation.topK } : {})
        }),
      style: (prompts) => command({ type: 'style', id: 0, prompts }),
      pause: (paused) => command({ type: 'pause', id: 0, paused }),
      keepalive: () => command({ type: 'keepalive', id: 0 }),
      close: () => {
        if (phase === 'open') {
          phase = 'closing';
          settlePending();
          shutDown();
        }
        return closedPromise;
      }
    };

    const deadline = clock.schedule(
      clock.now() + (options.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_SECONDS),
      () =>
        failStartup(
          lastRefusedBusy
            ? connectorError('magenta-rt2-busy', 'provider', true)
            : connectorError('magenta-rt2-connect-timeout', 'network', true)
        )
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    connect();
  });
}
