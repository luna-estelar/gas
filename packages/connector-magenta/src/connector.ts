import type {
  AudioSink,
  CapabilitiesTable,
  ClockTimer,
  Connector,
  ConnectorConfig,
  ConnectorConfigValidation,
  ConnectorDescription,
  ConnectorSettings,
  ConnectorTiming,
  ConnectorUpdate,
  EffectiveState,
  MonotonicClock,
  MusicalPosition,
  RendererFailure
} from '@luna-estelar/gas-protocol';
import { ConnectorError } from '@luna-estelar/gas-protocol';
import {
  DEFAULT_MAGENTA_CONFIG,
  MAGENTA_CONFIG_SCHEMA,
  type MagentaConnectorConfig,
  validateAndResolveMagentaConfig,
  validateMagentaConfig
} from './config.js';
import {
  MAGENTA_BRIDGE_PROTOCOL,
  MAGENTA_MODEL_ID,
  PCM_BYTES_PER_FRAME,
  PCM_BYTES_PER_SECOND,
  PCM_CHANNELS,
  PCM_SAMPLE_RATE
} from './constants.js';
import { selectPitches } from './notes.js';
import { translatePrompts, type WeightedPrompt } from './prompts.js';
import { type ResolvedMagentaSettings, validateMagentaSettings } from './settings.js';

type ConnectorState = 'new' | 'opened' | 'prepared' | 'starting' | 'running' | 'stopped' | 'closed';

/** The part of the WHATWG WebSocket the connector uses, so tests can supply their own. */
export interface MagentaSocket {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { readonly code?: number }) => void) | null;
  send(data: string): void;
  close(code?: number): void;
}

export interface MagentaConnectorDependencies {
  readonly clock: MonotonicClock;
  readonly setupTimeoutSeconds: number;
  readonly createSocket: (url: string) => MagentaSocket;
}

/** One `control` message: the whole of what the bridge should generate from now. */
type ControlMessage = {
  readonly type: 'control';
  readonly prompts: readonly WeightedPrompt[];
  readonly pitches: readonly number[] | null;
  readonly drums: MagentaConnectorConfig['generation']['drums'];
  readonly temperature: number;
  readonly topK: number;
  readonly styleGuidance: number;
  readonly notesGuidance: number;
  readonly reset: boolean;
};

type WarningCode =
  'magenta-behind-real-time' | 'magenta-bridge-warning' | 'magenta-notation-skipped';

const MAGENTA_WARNING_MESSAGE = 'The Magenta connector reported an operational warning.';
const MAGENTA_FAILURE_MESSAGE = 'The Magenta connector stopped audio generation.';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

/**
 * Magenta RealTime 2 support levels for each GAS intent. Style is a blend of
 * text prompts, so flavor and timbre are native and level becomes a blend
 * weight. Tempo and key have no control of their own and are described in
 * words. Notes and motif give the model pitches; it chooses the rhythm.
 */
export const MAGENTA_CAPABILITIES: CapabilitiesTable = deepFreeze({
  intents: {
    flavor: 'supported',
    key: 'approximated',
    tempo: 'approximated',
    time_signature: 'unsupported',
    timbre: 'supported',
    level: 'approximated',
    notes: 'approximated',
    motif: 'approximated'
  }
});

const MAGENTA_DESCRIPTION: ConnectorDescription = deepFreeze({
  id: 'magenta',
  displayName: 'Magenta RealTime',
  capabilities: MAGENTA_CAPABILITIES,
  model: {
    connectorId: 'magenta',
    modelId: MAGENTA_MODEL_ID,
    displayName: 'Magenta RealTime 2',
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: PCM_SAMPLE_RATE,
    channels: PCM_CHANNELS,
    chunkDurationSeconds: 0.4
  },
  configSchema: MAGENTA_CONFIG_SCHEMA,
  defaultConfig: DEFAULT_MAGENTA_CONFIG,
  supportsFlowControl: true
});

function connectorError(
  code: string,
  reason: 'network' | 'auth' | 'quota' | 'provider' | 'internal',
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

function stateConflict(): ConnectorError {
  return connectorError('magenta-state-conflict', 'internal', false);
}

function safeError(error: unknown, fallback: ConnectorError): ConnectorError {
  return ConnectorError.isConnectorError(error) ? error : fallback;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: ConnectorError): void;
}

function deferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: ConnectorError) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value): void {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
    reject(error): void {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    }
  };
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

type WebSocketConstructor = new (url: string) => MagentaSocket;

const DEFAULT_DEPENDENCIES: MagentaConnectorDependencies = {
  clock: new SystemClock(),
  setupTimeoutSeconds: 15,
  createSocket: (url) => {
    const WebSocketClass = (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
    if (WebSocketClass === undefined) {
      throw connectorError('magenta-websocket-unavailable', 'internal', false);
    }
    return new WebSocketClass(url);
  }
};

function pcmBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  return undefined;
}

type BridgeMessage = { readonly type?: unknown; readonly [key: string]: unknown };

function parseBridgeMessage(data: string): BridgeMessage | undefined {
  try {
    const value: unknown = JSON.parse(data);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as BridgeMessage)
      : undefined;
  } catch {
    return undefined;
  }
}

export class MagentaConnector implements Connector {
  private state: ConnectorState = 'new';
  private settings: ResolvedMagentaSettings | undefined;
  private preparedState: EffectiveState | undefined;
  private config: MagentaConnectorConfig | undefined;
  private socket: MagentaSocket | undefined;
  private sink: AudioSink | undefined;
  private timing: ConnectorTiming | undefined;
  private runId: string | undefined;
  private sessionToken = 0;
  private opened = false;
  private readyReceived = false;
  private terminalFailureReported = false;
  private bridgeFailure: ConnectorError | undefined;
  private runActive = false;
  private promptsNonEmpty = false;
  private flowPaused = false;
  private playbackState: 'paused' | 'playing' = 'paused';
  private notationWarned = false;
  private behindWarned = false;

  constructor(private readonly dependencies: MagentaConnectorDependencies = DEFAULT_DEPENDENCIES) {}

  async describe(): Promise<ConnectorDescription> {
    return MAGENTA_DESCRIPTION;
  }

  async open(settings: ConnectorSettings): Promise<void> {
    if (this.state !== 'new') throw stateConflict();
    this.settings = validateMagentaSettings(settings);
    this.state = 'opened';
  }

  validateConfig(config: ConnectorConfig): ConnectorConfigValidation {
    return validateMagentaConfig(config);
  }

  async prepare(initialState: EffectiveState, config: ConnectorConfig): Promise<void> {
    if (this.state !== 'opened' && this.state !== 'stopped') throw stateConflict();
    this.config = validateAndResolveMagentaConfig(config);
    this.preparedState = initialState;
    this.flowPaused = false;
    this.promptsNonEmpty = false;
    this.playbackState = 'paused';
    this.notationWarned = false;
    this.behindWarned = false;
    this.state = 'prepared';
  }

  async start(sink: AudioSink, timing: ConnectorTiming, runId: string): Promise<void> {
    if (this.state !== 'prepared' || this.settings === undefined) throw stateConflict();
    const initialState = this.preparedState;
    if (initialState === undefined || this.config === undefined) throw stateConflict();

    this.state = 'starting';
    this.sink = sink;
    this.timing = timing;
    this.runId = runId;
    this.runActive = true;
    this.opened = false;
    this.readyReceived = false;
    this.terminalFailureReported = false;
    this.bridgeFailure = undefined;
    const token = ++this.sessionToken;

    const ready = deferred<void>();
    const startupFailure = deferred<never>();
    const timeout = this.dependencies.clock.schedule(
      this.dependencies.clock.now() + this.dependencies.setupTimeoutSeconds,
      () => startupFailure.reject(connectorError('magenta-setup-timeout', 'network', true))
    );

    try {
      const socket = this.dependencies.createSocket(this.settings.endpoint);
      this.socket = socket;
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => this.handleOpen(token, runId);
      socket.onmessage = (event) =>
        this.handleMessage(event.data, ready, startupFailure, token, runId);
      // Every WebSocket error is followed by a close, which carries the code.
      socket.onerror = () => undefined;
      socket.onclose = (event) => this.handleClose(event.code, startupFailure, token, runId);

      await Promise.race([ready.promise, startupFailure.promise]);
      if (!this.isActive(token, runId)) throw stateConflict();
      this.sendControl(initialState, true, token, runId);
      this.reconcilePlayback(token, runId);
      this.state = 'running';
    } catch (error) {
      const failure = safeError(
        error,
        connectorError('magenta-startup-failure', 'internal', false)
      );
      this.finishSession(runId);
      this.state = 'stopped';
      throw failure;
    } finally {
      this.dependencies.clock.cancel(timeout);
    }
  }

  async update(
    update: ConnectorUpdate,
    requestedBoundary: MusicalPosition
  ): Promise<MusicalPosition> {
    if (this.state !== 'running') throw stateConflict();
    const token = this.sessionToken;
    const runId = this.runId;
    if (runId === undefined || !this.isActive(token, runId)) throw stateConflict();
    this.sendControl(update.state, false, token, runId);
    this.reconcilePlayback(token, runId);
    return requestedBoundary;
  }

  async setGenerationPaused(paused: boolean): Promise<void> {
    if (this.state !== 'running' || this.runId === undefined) throw stateConflict();
    if (this.flowPaused === paused) return;
    this.flowPaused = paused;
    this.reconcilePlayback(this.sessionToken, this.runId);
  }

  async stop(runId: string): Promise<void> {
    if (this.state === 'closed') return;
    if (this.runId === undefined || this.runId !== runId) return;
    this.finishSession(runId);
    this.state = 'stopped';
  }

  async close(): Promise<void> {
    if (this.state === 'closed') return;
    const activeRunId = this.runId;
    if (activeRunId !== undefined) this.finishSession(activeRunId);
    else this.closeSocketBestEffort();
    this.settings = undefined;
    this.preparedState = undefined;
    this.config = undefined;
    this.state = 'closed';
  }

  private handleOpen(token: number, runId: string): void {
    if (!this.isActive(token, runId)) return;
    this.opened = true;
    const secret = this.settings?.token;
    this.send(
      {
        type: 'hello',
        protocol: MAGENTA_BRIDGE_PROTOCOL,
        ...(secret !== undefined ? { token: secret } : {})
      },
      token,
      runId
    );
  }

  private controlFor(state: EffectiveState, reset: boolean): ControlMessage {
    const config = this.config;
    const timing = this.timing;
    if (config === undefined || timing === undefined) throw stateConflict();
    const prompts = translatePrompts(state, config.prompt, timing);
    const selection = selectPitches(state);
    if (selection.skipped && !this.notationWarned) {
      this.notationWarned = true;
      this.emitWarning('magenta-notation-skipped');
    }
    this.promptsNonEmpty = prompts.length > 0;
    return {
      type: 'control',
      prompts: prompts.map(({ text, weight }) => ({ text, weight })),
      pitches: selection.pitches ?? null,
      drums: config.generation.drums,
      temperature: config.generation.temperature,
      topK: config.generation.topK,
      styleGuidance: config.generation.styleGuidance,
      notesGuidance: config.generation.notesGuidance,
      reset
    };
  }

  private sendControl(state: EffectiveState, reset: boolean, token: number, runId: string): void {
    this.send(this.controlFor(state, reset), token, runId);
  }

  /** Play only with something to play and room to put it; otherwise hold the model. */
  private reconcilePlayback(token: number, runId: string): void {
    const shouldPlay = this.runActive && this.promptsNonEmpty && !this.flowPaused;
    const nextState = shouldPlay ? 'playing' : 'paused';
    if (nextState === this.playbackState) return;
    this.send({ type: shouldPlay ? 'play' : 'pause' }, token, runId);
    this.playbackState = nextState;
    const sink = this.sink;
    try {
      if (sink !== undefined && shouldPlay) sink.status('streaming', runId);
      else if (sink !== undefined && this.flowPaused) sink.status('throttled', runId);
    } catch {
      // Host callbacks are isolated and never stringified or logged here.
    }
  }

  private send(message: object, token: number, runId: string): void {
    if (!this.isActive(token, runId) || this.socket === undefined) throw stateConflict();
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      throw connectorError('magenta-network-failure', 'network', true);
    }
  }

  private handleMessage(
    data: unknown,
    ready: Deferred<void>,
    startupFailure: Deferred<never>,
    token: number,
    runId: string
  ): void {
    if (!this.isActive(token, runId)) return;
    if (typeof data === 'string') {
      this.handleBridgeMessage(parseBridgeMessage(data), ready, startupFailure, token);
      return;
    }
    const bytes = pcmBytes(data);
    if (bytes === undefined || bytes.length === 0 || bytes.length % PCM_BYTES_PER_FRAME !== 0) {
      this.fail(connectorError('magenta-malformed-audio', 'provider', true), startupFailure, token);
      return;
    }
    if (!this.readyReceived) return;
    this.sink?.push({
      runId,
      bytes,
      codec: 'pcm',
      sampleFormat: 's16le',
      sampleRate: PCM_SAMPLE_RATE,
      channels: PCM_CHANNELS,
      durationSeconds: bytes.length / PCM_BYTES_PER_SECOND
    });
  }

  private handleBridgeMessage(
    message: BridgeMessage | undefined,
    ready: Deferred<void>,
    startupFailure: Deferred<never>,
    token: number
  ): void {
    if (message === undefined) return;
    if (message.type === 'ready' && !this.readyReceived) {
      // The bridge decides chunk size, but not the format: GAS hands the host
      // exactly what `describe()` promised.
      if (
        message.protocol !== MAGENTA_BRIDGE_PROTOCOL ||
        message.sampleRate !== PCM_SAMPLE_RATE ||
        message.channels !== PCM_CHANNELS
      ) {
        this.fail(
          connectorError('magenta-unsupported-bridge', 'provider', false),
          startupFailure,
          token
        );
        return;
      }
      this.readyReceived = true;
      ready.resolve(undefined);
    } else if (message.type === 'warning') {
      if (message.code === 'behind-real-time') {
        if (!this.behindWarned) {
          this.behindWarned = true;
          this.emitWarning('magenta-behind-real-time');
        }
      } else this.emitWarning('magenta-bridge-warning');
    } else if (message.type === 'error') {
      // The close that follows carries the code; remember why it is coming.
      this.bridgeFailure = connectorError('magenta-generation-failed', 'provider', true);
    }
  }

  /**
   * Classify only the standard close codes, and pass the raw number through as
   * `closeCode`. The bridge closes with 1008 for a rejected hello or token, 1002
   * for a message it does not accept and 1011 when the model fails. An
   * application code (4000-4999) belongs to whoever serves the endpoint.
   */
  private classifyClose(code: number | undefined): ConnectorError {
    if (!this.opened) {
      return connectorError('magenta-bridge-unreachable', 'network', true, code);
    }
    if (!this.readyReceived && code === 1008) {
      return connectorError('magenta-auth-rejected', 'auth', false, code);
    }
    if (code === 1002 || code === 1003 || code === 1009) {
      return connectorError('magenta-protocol-rejected', 'internal', false, code);
    }
    if (code === 1011) {
      const failure = this.bridgeFailure;
      return failure !== undefined
        ? connectorError(failure.code, failure.reason, failure.retryable, code)
        : connectorError('magenta-provider-failure', 'provider', true, code);
    }
    return connectorError('magenta-network-failure', 'network', true, code);
  }

  private handleClose(
    code: number | undefined,
    startupFailure: Deferred<never>,
    token: number,
    runId: string
  ): void {
    if (!this.isActive(token, runId)) return;
    this.socket = undefined;
    this.fail(this.classifyClose(code), startupFailure, token);
  }

  private fail(failure: ConnectorError, startupFailure: Deferred<never>, token: number): void {
    const runId = this.runId;
    if (runId === undefined || !this.isActive(token, runId)) return;
    if (this.state === 'starting') {
      startupFailure.reject(failure);
      return;
    }
    this.reportTerminalFailure(failure, token, runId);
  }

  private emitWarning(code: WarningCode): void {
    const sink = this.sink;
    if (sink === undefined) return;
    try {
      sink.warning({
        code,
        message: MAGENTA_WARNING_MESSAGE,
        ...(this.runId ? { runId: this.runId } : {})
      });
    } catch {
      // Host callbacks are isolated and never stringified or logged here.
    }
  }

  private reportTerminalFailure(failure: ConnectorError, token: number, runId: string): void {
    if (!this.isActive(token, runId) || this.terminalFailureReported) return;
    this.terminalFailureReported = true;
    const sink = this.sink;
    const event: RendererFailure = {
      code: failure.code,
      message: MAGENTA_FAILURE_MESSAGE,
      reason: failure.reason,
      runId,
      retryable: failure.retryable,
      ...(failure.closeCode !== undefined ? { closeCode: failure.closeCode } : {})
    };
    this.finishSession(runId);
    this.state = 'stopped';
    try {
      sink?.failure(event);
    } catch {
      // Host callbacks are isolated and never stringified or logged here.
    }
  }

  private isActive(token: number, runId: string): boolean {
    return this.sessionToken === token && this.runId === runId && this.runActive;
  }

  private finishSession(runId: string): void {
    if (this.runId !== runId) return;
    this.runActive = false;
    this.sessionToken++;
    this.closeSocketBestEffort();
    this.sink = undefined;
    this.timing = undefined;
    this.runId = undefined;
    this.promptsNonEmpty = false;
    this.flowPaused = false;
    this.playbackState = 'paused';
    this.bridgeFailure = undefined;
  }

  private closeSocketBestEffort(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (socket === undefined) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close(1000);
    } catch {
      // Closing is best effort and never exposes transport details.
    }
  }
}

export function createMagentaConnector(): Connector {
  return new MagentaConnector();
}

export function createMagentaConnectorWithDependencies(
  dependencies: MagentaConnectorDependencies
): Connector {
  return new MagentaConnector(dependencies);
}
