// The Magenta RT2 connector: one WebSocket to the bridge per run, carrying style
// prompts out and 160 ms PCM packets back. Each start is an attempt that owns
// its socket, timers and pending commands; ending it detaches the socket's
// handlers, so nothing from an ended attempt reaches a later one.

import type {
  AudioSink,
  CapabilitiesTable,
  ClockTimer,
  Connector,
  ConnectorConfig,
  ConnectorConfigValidation,
  ConnectorDescription,
  ConnectorFailureReason,
  ConnectorSettings,
  ConnectorTiming,
  ConnectorUpdate,
  EffectiveState,
  MonotonicClock,
  MusicalPosition,
  RendererFailure
} from '@luna-estelar/gas/protocol';
import { ConnectorError } from '@luna-estelar/gas/protocol';
import {
  DEFAULT_MAGENTA_RT2_CONFIG,
  MAGENTA_RT2_CONFIG_SCHEMA,
  type MagentaRt2ConnectorConfig,
  deepFreeze,
  validateAndResolveMagentaRt2Config,
  validateMagentaRt2Config
} from './config.js';
import { MAX_PROMPTS, translatePrompts, type WeightedPrompt } from './prompts.js';
import {
  CHANNELS,
  FRAMES_PER_PACKET,
  PROTOCOL_VERSION,
  SAMPLE_RATE,
  decodeAudioPacket,
  parseServerMessage,
  type ClientMessage,
  type ServerHello
} from './protocol.js';
import { type MagentaRt2ConnectorSettings, validateMagentaRt2Settings } from './settings.js';

/**
 * The slice of the WebSocket API the connector uses, so tests can drive it and
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

export interface MagentaRt2ConnectorDependencies {
  readonly clock: MonotonicClock;
  readonly createSocket: (url: string) => BridgeSocket;
}

type ConnectorState = 'new' | 'opened' | 'prepared' | 'starting' | 'running' | 'stopped' | 'closed';

/** Wait this long between attempts when the bridge says another session is active. */
const BUSY_RETRY_SECONDS = 0.1;
/** A command the bridge never answers fails the run after this long. */
const COMMAND_TIMEOUT_SECONDS = 20;

const WARNING_MESSAGE = 'The Magenta RT2 connector reported an operational warning.';
const FAILURE_MESSAGE = 'The Magenta RT2 connector stopped audio generation.';

/** Magenta RT2 support levels for each GAS intent. */
export const MAGENTA_RT2_CAPABILITIES: CapabilitiesTable = deepFreeze({
  intents: {
    flavor: 'supported',
    timbre: 'supported',
    // Relative prompt weights, not independent stem gain.
    level: 'approximated',
    // Described in the prompt text; the model has no native key or tempo control.
    key: 'approximated',
    tempo: 'approximated',
    time_signature: 'unsupported',
    notes: 'unsupported',
    motif: 'unsupported'
  }
});

const DESCRIPTION: ConnectorDescription = deepFreeze({
  id: 'magenta-rt2',
  displayName: 'Magenta RealTime 2',
  capabilities: MAGENTA_RT2_CAPABILITIES,
  model: {
    connectorId: 'magenta-rt2',
    modelId: 'magenta-rt-2',
    displayName: 'Magenta RealTime 2',
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    chunkDurationSeconds: FRAMES_PER_PACKET / SAMPLE_RATE
  },
  configSchema: MAGENTA_RT2_CONFIG_SCHEMA,
  defaultConfig: DEFAULT_MAGENTA_RT2_CONFIG,
  supportsFlowControl: true
});

function connectorError(
  code: string,
  reason: ConnectorFailureReason,
  retryable: boolean,
  closeCode?: number
): ConnectorError {
  return new ConnectorError({
    code,
    reason,
    retryable,
    ...(closeCode !== undefined ? { closeCode } : {})
  });
}

const stateConflict = () => connectorError('magenta-rt2-state-conflict', 'internal', false);
const cancelledStart = () => connectorError('magenta-rt2-start-cancelled', 'internal', false);
const protocolViolation = () => connectorError('magenta-rt2-protocol-violation', 'provider', false);
const networkFailure = (closeCode?: number) =>
  connectorError('magenta-rt2-network-failure', 'network', true, closeCode);

function commandError(code: string, retryable: boolean): ConnectorError {
  if (code === 'prompt-encode-failed') {
    return connectorError('magenta-rt2-prompt-encode-failed', 'provider', retryable);
  }
  if (code === 'engine-failure') {
    return connectorError('magenta-rt2-engine-failure', 'provider', retryable);
  }
  return connectorError('magenta-rt2-command-rejected', 'internal', false);
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: ConnectorError): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: ConnectorError) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Calls the host's sink and ignores what it throws. */
function hostCall(call: () => void): void {
  try {
    call();
  } catch {
    // Host callbacks are isolated and never stringified or logged here.
  }
}

function closeQuietly(socket: BridgeSocket): void {
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

interface Attempt {
  readonly runId: string;
  readonly sink: AudioSink;
  readonly timing: ConnectorTiming;
  readonly config: MagentaRt2ConnectorConfig;
  /** Rejects with whatever ends the attempt first: a failure, the deadline or Stop. */
  readonly startup: Deferred<never>;
  readonly timers: Set<ClockTimer>;
  readonly pending: Map<number, Deferred<void>>;
  socket: BridgeSocket | undefined;
  greeted: boolean;
  cancelled: boolean;
  starting: boolean;
  nextCommandId: number;
  /** The bridge has been sent `start` and is generating, paused or not. */
  generating: boolean;
  /** What the bridge was last told to play. Kept while silent, so a return needs no resend. */
  bridgePrompts: readonly WeightedPrompt[];
  /** No track is active, so generation is paused. */
  silent: boolean;
  flowPaused: boolean;
  bridgePaused: boolean;
  warnedOverflow: boolean;
  warnedTruncation: boolean;
}

export class MagentaRt2Connector implements Connector {
  private state: ConnectorState = 'new';
  private settings: MagentaRt2ConnectorSettings | undefined;
  private preparedState: EffectiveState | undefined;
  private config: MagentaRt2ConnectorConfig | undefined;
  private attempt: Attempt | undefined;

  constructor(private readonly dependencies: MagentaRt2ConnectorDependencies) {}

  async describe(): Promise<ConnectorDescription> {
    return DESCRIPTION;
  }

  async open(settings: ConnectorSettings): Promise<void> {
    if (this.state !== 'new') throw stateConflict();
    this.settings = validateMagentaRt2Settings(settings);
    this.state = 'opened';
  }

  validateConfig(config: ConnectorConfig): ConnectorConfigValidation {
    return validateMagentaRt2Config(config);
  }

  async prepare(initialState: EffectiveState, config: ConnectorConfig): Promise<void> {
    // The renderer abandons a run stopped during prepare without calling start.
    if (this.state !== 'opened' && this.state !== 'stopped' && this.state !== 'prepared') {
      throw stateConflict();
    }
    this.config = validateAndResolveMagentaRt2Config(config);
    this.preparedState = initialState;
    this.state = 'prepared';
  }

  async start(sink: AudioSink, timing: ConnectorTiming, runId: string): Promise<void> {
    const settings = this.settings;
    const config = this.config;
    const initialState = this.preparedState;
    if (this.state !== 'prepared' || !settings || !config || !initialState) throw stateConflict();

    this.state = 'starting';
    const attempt: Attempt = {
      runId,
      sink,
      timing,
      config,
      startup: deferred<never>(),
      timers: new Set(),
      pending: new Map(),
      socket: undefined,
      greeted: false,
      cancelled: false,
      starting: true,
      nextCommandId: 1,
      generating: false,
      bridgePrompts: [],
      silent: false,
      flowPaused: false,
      bridgePaused: false,
      warnedOverflow: false,
      warnedTruncation: false
    };
    this.attempt = attempt;
    const deadline = this.schedule(attempt, config.connectTimeoutSeconds, () =>
      attempt.startup.reject(connectorError('magenta-rt2-connect-timeout', 'network', true))
    );

    try {
      await this.greet(attempt, settings);
      await this.apply(attempt, initialState);
      attempt.starting = false;
      this.state = 'running';
    } catch (error) {
      const failure = attempt.cancelled
        ? cancelledStart()
        : ConnectorError.isConnectorError(error)
          ? error
          : connectorError('magenta-rt2-startup-failure', 'internal', false);
      if (this.attempt === attempt) {
        this.finishAttempt(attempt);
        this.state = 'stopped';
      }
      throw failure;
    } finally {
      this.cancelTimer(attempt, deadline);
    }
  }

  async update(
    update: ConnectorUpdate,
    requestedBoundary: MusicalPosition
  ): Promise<MusicalPosition> {
    const attempt = this.attempt;
    if (this.state !== 'running' || attempt === undefined) throw stateConflict();
    await this.apply(attempt, update.state);
    return requestedBoundary;
  }

  async setGenerationPaused(paused: boolean): Promise<void> {
    const attempt = this.attempt;
    if (this.state !== 'running' || attempt === undefined) throw stateConflict();
    attempt.flowPaused = paused;
    await this.reconcilePause(attempt);
  }

  async stop(runId: string): Promise<void> {
    const attempt = this.attempt;
    if (attempt === undefined || attempt.runId !== runId) return;
    attempt.cancelled = true;
    this.finishAttempt(attempt);
    this.state = 'stopped';
  }

  async close(): Promise<void> {
    const attempt = this.attempt;
    if (attempt !== undefined) {
      attempt.cancelled = true;
      this.finishAttempt(attempt);
    }
    this.settings = undefined;
    this.preparedState = undefined;
    this.config = undefined;
    this.state = 'closed';
  }

  /** Connect and exchange hellos, retrying while the bridge is busy. */
  private async greet(attempt: Attempt, settings: MagentaRt2ConnectorSettings): Promise<void> {
    for (;;) {
      const hello = deferred<ServerHello>();
      this.openSocket(attempt, settings, hello);
      try {
        const answer = await Promise.race([hello.promise, attempt.startup.promise]);
        if (
          answer.protocol !== PROTOCOL_VERSION ||
          answer.encoding !== 'pcm_s16le' ||
          answer.sampleRate !== SAMPLE_RATE ||
          answer.channels !== CHANNELS ||
          answer.maxPrompts < MAX_PROMPTS
        ) {
          throw protocolViolation();
        }
        attempt.greeted = true;
        return;
      } catch (error) {
        const busy = ConnectorError.isConnectorError(error) && error.code === 'magenta-rt2-busy';
        if (!busy) throw error;
        // The previous session on this bridge, often this connector's own last
        // run, is still being released. Try again shortly, within the deadline.
        this.dropSocket(attempt);
        await Promise.race([this.delay(attempt, BUSY_RETRY_SECONDS), attempt.startup.promise]);
      }
    }
  }

  private openSocket(
    attempt: Attempt,
    settings: MagentaRt2ConnectorSettings,
    hello: Deferred<ServerHello>
  ): void {
    let socket: BridgeSocket;
    try {
      socket = this.dependencies.createSocket(settings.endpoint);
    } catch {
      hello.reject(networkFailure());
      return;
    }
    attempt.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      this.sendRaw(attempt, {
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        ...(settings.token !== undefined ? { token: settings.token } : {})
      });
    };
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') this.handleText(attempt, event.data, hello);
      else if (event.data instanceof ArrayBuffer) this.handleAudio(attempt, event.data);
      else this.handleFailure(attempt, protocolViolation());
    };
    // A WebSocket always reports a close after an error, and only the close
    // carries a code, so the error event itself is ignored. Every refusal the
    // bridge explains arrives as an error message before its close.
    socket.onerror = () => undefined;
    socket.onclose = (event) => {
      const failure = networkFailure(event.code);
      if (!attempt.greeted) hello.reject(failure);
      else this.handleFailure(attempt, failure);
    };
  }

  private async apply(attempt: Attempt, state: EffectiveState): Promise<void> {
    const { prompts, overflowed, truncated } = translatePrompts(
      attempt.timing,
      state,
      attempt.config.prompt
    );
    if (overflowed && !attempt.warnedOverflow) {
      attempt.warnedOverflow = true;
      this.emitWarning(attempt, 'magenta-rt2-prompt-overflow');
    }
    if (truncated && !attempt.warnedTruncation) {
      attempt.warnedTruncation = true;
      this.emitWarning(attempt, 'magenta-rt2-prompt-truncated');
    }
    if (prompts.length > 0) {
      if (!attempt.generating) {
        const generation = attempt.config.generation;
        await this.command(attempt, {
          type: 'start',
          id: 0,
          prompts,
          ...(generation.temperature !== undefined ? { temperature: generation.temperature } : {}),
          ...(generation.topK !== undefined ? { topK: generation.topK } : {})
        });
        attempt.generating = true;
      } else if (!samePrompts(prompts, attempt.bridgePrompts)) {
        await this.command(attempt, { type: 'style', id: 0, prompts });
      }
      attempt.bridgePrompts = prompts;
    }
    attempt.silent = prompts.length === 0;
    await this.reconcilePause(attempt);
  }

  /** Generation runs only with something to play and no flow-control pause. */
  private async reconcilePause(attempt: Attempt): Promise<void> {
    if (!attempt.generating) return;
    const paused = attempt.flowPaused || attempt.silent;
    if (paused !== attempt.bridgePaused) {
      await this.command(attempt, { type: 'pause', id: 0, paused });
      attempt.bridgePaused = paused;
    }
    if (paused && attempt.flowPaused) {
      hostCall(() => attempt.sink.status('throttled', attempt.runId));
    } else if (!paused) {
      hostCall(() => attempt.sink.status('streaming', attempt.runId));
    }
  }

  /** Send a command and wait for its ack. The `id` given is replaced. */
  private async command(
    attempt: Attempt,
    message: Exclude<ClientMessage, { readonly type: 'hello' }>
  ): Promise<void> {
    const id = attempt.nextCommandId++;
    const answer = deferred<void>();
    attempt.pending.set(id, answer);
    const timeout = this.schedule(attempt, COMMAND_TIMEOUT_SECONDS, () =>
      this.handleFailure(attempt, connectorError('magenta-rt2-command-timeout', 'network', true))
    );
    try {
      this.sendRaw(attempt, { ...message, id } as ClientMessage);
      await Promise.race([answer.promise, attempt.startup.promise]);
    } finally {
      attempt.pending.delete(id);
      this.cancelTimer(attempt, timeout);
    }
  }

  private sendRaw(attempt: Attempt, message: ClientMessage): void {
    try {
      attempt.socket!.send(JSON.stringify(message));
    } catch {
      throw networkFailure();
    }
  }

  private handleText(attempt: Attempt, text: string, hello: Deferred<ServerHello>): void {
    const message = parseServerMessage(text);
    if (message === undefined) {
      this.handleFailure(attempt, protocolViolation());
      return;
    }
    if (message.type === 'hello') {
      hello.resolve(message);
      return;
    }
    if (message.type === 'ack') {
      attempt.pending.get(message.id)?.resolve(undefined);
      return;
    }
    // An error answering a command fails that command; one without an id is
    // the bridge ending the session, and its close follows.
    const failure = commandError(message.code, message.retryable);
    if (message.id !== undefined) {
      attempt.pending.get(message.id)?.reject(failure);
    } else if (!attempt.greeted) {
      hello.reject(
        message.code === 'busy'
          ? connectorError('magenta-rt2-busy', 'provider', true)
          : message.code === 'unauthorized' || message.code === 'forbidden-origin'
            ? connectorError('magenta-rt2-auth-rejected', 'auth', false)
            : failure
      );
    } else {
      this.handleFailure(attempt, failure);
    }
  }

  private handleAudio(attempt: Attempt, data: ArrayBuffer): void {
    const packet = decodeAudioPacket(data);
    if (packet === undefined) {
      this.handleFailure(attempt, protocolViolation());
      return;
    }
    hostCall(() =>
      attempt.sink.push({
        runId: attempt.runId,
        bytes: packet.pcm,
        codec: 'pcm',
        sampleFormat: 's16le',
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        durationSeconds: packet.frames / SAMPLE_RATE
      })
    );
  }

  private handleFailure(attempt: Attempt, failure: ConnectorError): void {
    if (attempt.starting) attempt.startup.reject(failure);
    else this.reportTerminalFailure(attempt, failure);
  }

  private reportTerminalFailure(attempt: Attempt, failure: ConnectorError): void {
    const event: RendererFailure = {
      code: failure.code,
      message: FAILURE_MESSAGE,
      reason: failure.reason,
      runId: attempt.runId,
      retryable: failure.retryable,
      ...(failure.closeCode !== undefined ? { closeCode: failure.closeCode } : {})
    };
    this.finishAttempt(attempt);
    this.state = 'stopped';
    hostCall(() => attempt.sink.failure(event));
  }

  private emitWarning(
    attempt: Attempt,
    code: 'magenta-rt2-prompt-overflow' | 'magenta-rt2-prompt-truncated'
  ): void {
    hostCall(() => attempt.sink.warning({ code, message: WARNING_MESSAGE, runId: attempt.runId }));
  }

  private schedule(attempt: Attempt, delaySeconds: number, callback: () => void): ClockTimer {
    const clock = this.dependencies.clock;
    const timer = clock.schedule(clock.now() + delaySeconds, callback);
    attempt.timers.add(timer);
    return timer;
  }

  private cancelTimer(attempt: Attempt, timer: ClockTimer): void {
    attempt.timers.delete(timer);
    this.dependencies.clock.cancel(timer);
  }

  private delay(attempt: Attempt, seconds: number): Promise<void> {
    return new Promise((resolve) => this.schedule(attempt, seconds, resolve));
  }

  private dropSocket(attempt: Attempt): void {
    const socket = attempt.socket;
    attempt.socket = undefined;
    if (socket !== undefined) closeQuietly(socket);
  }

  /**
   * Ends the current attempt, once: settles anything waiting on it, cancels its
   * timers and closes its socket, which the bridge takes as the end of the session.
   */
  private finishAttempt(attempt: Attempt): void {
    this.attempt = undefined;
    for (const timer of attempt.timers) this.dependencies.clock.cancel(timer);
    attempt.timers.clear();
    attempt.startup.reject(stateConflict());
    this.dropSocket(attempt);
  }
}

function samePrompts(a: readonly WeightedPrompt[], b: readonly WeightedPrompt[]): boolean {
  return (
    a.length === b.length &&
    a.every((prompt, index) => prompt.text === b[index]!.text && prompt.weight === b[index]!.weight)
  );
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

/** A connector for a bridge, using the platform's `WebSocket` (Node 22+ or a browser). */
export function createMagentaRt2Connector(): Connector {
  return new MagentaRt2Connector({ clock: new SystemClock(), createSocket: globalSocket });
}

/** For tests and hosts that supply their own socket or clock. */
export function createMagentaRt2ConnectorWithDependencies(
  dependencies: MagentaRt2ConnectorDependencies
): Connector {
  return new MagentaRt2Connector(dependencies);
}
