import { GoogleGenAI } from '@google/genai';
import type { LiveMusicGenerationConfig } from '@google/genai';
import type {
  AudioSink,
  CapabilitiesTable,
  ClockTimer,
  Connector,
  ConnectorConfig,
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
  DEFAULT_LYRIA_CONFIG,
  LYRIA_CONFIG_SCHEMA,
  type LyriaConnectorConfig,
  validateAndResolveLyriaConfig
} from './config.js';
import {
  HOSTED_CLOSE_CODE,
  HOSTED_SENTINEL,
  LYRIA_API_VERSION,
  LYRIA_MODEL_ID,
  PCM_BYTES_PER_FRAME,
  PCM_BYTES_PER_SECOND,
  PCM_CHANNELS,
  PCM_SAMPLE_RATE
} from './constants.js';
import { translatePrompts, type WeightedPrompt } from './prompts.js';
import { classifyKey, type LyriaScale } from './scale.js';
import { type LyriaConnectorSettings, validateLyriaSettings } from './settings.js';
import { createPromptTransition, type PromptTransition } from './transition.js';

type ConnectorState = 'new' | 'opened' | 'prepared' | 'starting' | 'running' | 'stopped' | 'closed';

type LyriaClientOptions = {
  readonly apiKey: string;
  readonly apiVersion: typeof LYRIA_API_VERSION;
  readonly httpOptions?: { readonly baseUrl: string };
};

type LyriaAudioChunk = { readonly data?: string };

type LyriaServerMessage = {
  readonly setupComplete?: unknown;
  readonly serverContent?: { readonly audioChunks?: readonly LyriaAudioChunk[] };
  readonly filteredPrompt?: unknown;
  readonly warning?: unknown;
};

type LyriaCallbacks = {
  readonly onmessage: (message: LyriaServerMessage) => void;
  readonly onerror: () => void;
  readonly onclose: (event: { readonly code?: number }) => void;
};

type LyriaMusicGenerationConfig = {
  readonly temperature: number;
  readonly guidance: number;
  readonly topK: number;
  readonly musicGenerationMode: 'QUALITY' | 'DIVERSITY';
  readonly bpm: number;
  readonly scale?: LyriaScale;
  readonly muteBass?: boolean;
  readonly muteDrums?: boolean;
  readonly onlyBassAndDrums?: boolean;
  readonly seed?: number;
  readonly density?: number;
  readonly brightness?: number;
};

export interface LyriaMusicSession {
  setWeightedPrompts(params: {
    readonly weightedPrompts: Array<{ readonly text: string; readonly weight: number }>;
  }): Promise<void>;
  setMusicGenerationConfig(params: {
    readonly musicGenerationConfig: LyriaMusicGenerationConfig;
  }): Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  resetContext(): void;
  close(): void;
}

export interface LyriaSdkClient {
  connect(params: {
    readonly model: string;
    readonly callbacks: LyriaCallbacks;
  }): Promise<LyriaMusicSession>;
}

export interface LyriaConnectorDependencies {
  readonly clock: MonotonicClock;
  readonly setupTimeoutSeconds: number;
  readonly createClient: (options: LyriaClientOptions) => LyriaSdkClient;
}

type ModelContext = { readonly bpm: number; readonly scale?: LyriaScale };

const LYRIA_WARNING_MESSAGE = 'The Lyria connector reported an operational warning.';
const LYRIA_FAILURE_MESSAGE = 'The Lyria connector stopped audio generation.';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

/** Lyria support levels for each GAS intent. */
export const LYRIA_CAPABILITIES: CapabilitiesTable = deepFreeze({
  intents: {
    flavor: 'supported',
    key: 'approximated',
    tempo: 'supported',
    time_signature: 'unsupported',
    timbre: 'supported',
    level: 'approximated',
    notes: 'unsupported',
    motif: 'unsupported'
  }
});

const LYRIA_DESCRIPTION: ConnectorDescription = deepFreeze({
  id: 'lyria',
  displayName: 'Lyria RealTime',
  capabilities: LYRIA_CAPABILITIES,
  model: {
    connectorId: 'lyria',
    modelId: LYRIA_MODEL_ID,
    displayName: 'Lyria RealTime',
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: PCM_SAMPLE_RATE,
    channels: PCM_CHANNELS,
    chunkDurationSeconds: 2
  },
  configSchema: LYRIA_CONFIG_SCHEMA,
  defaultConfig: DEFAULT_LYRIA_CONFIG,
  supportsFlowControl: true
});

function connectorError(
  code: string,
  reason: 'network' | 'auth' | 'quota' | 'provider' | 'internal',
  retryable: boolean
): ConnectorError {
  return new ConnectorError({ code, reason, retryable });
}

function stateConflict(): ConnectorError {
  return connectorError('lyria-state-conflict', 'internal', false);
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

const DEFAULT_DEPENDENCIES: LyriaConnectorDependencies = {
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
    throw connectorError('lyria-malformed-audio', 'provider', true);
  }
  const atobFunction = (globalThis as { atob?: (input: string) => string }).atob;
  if (atobFunction === undefined) {
    throw connectorError('lyria-audio-decoder-unavailable', 'internal', false);
  }
  let binary: string;
  try {
    binary = atobFunction(data);
  } catch {
    throw connectorError('lyria-malformed-audio', 'provider', true);
  }
  if (binary.length === 0 || binary.length % PCM_BYTES_PER_FRAME !== 0) {
    throw connectorError('lyria-malformed-audio', 'provider', true);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export class LyriaConnector implements Connector {
  private state: ConnectorState = 'new';
  private settings: LyriaConnectorSettings | undefined;
  private preparedState: EffectiveState | undefined;
  private config: LyriaConnectorConfig | undefined;
  private client: LyriaSdkClient | undefined;
  private session: LyriaMusicSession | undefined;
  private sink: AudioSink | undefined;
  private timing: ConnectorTiming | undefined;
  private runId: string | undefined;
  private transition: PromptTransition | undefined;
  private sessionToken = 0;
  private setupReceived = false;
  private terminalFailureReported = false;
  private startupFailure: ConnectorError | undefined;
  private runActive = false;
  private promptsNonEmpty = false;
  private flowPaused = false;
  private playbackState: 'paused' | 'playing' = 'paused';
  private stopSent = false;
  private lastModelContext: ModelContext | undefined;
  private readonly warnedTempos = new Set<number>();

  constructor(private readonly dependencies: LyriaConnectorDependencies = DEFAULT_DEPENDENCIES) {}

  async describe(): Promise<ConnectorDescription> {
    return LYRIA_DESCRIPTION;
  }

  async open(settings: ConnectorSettings): Promise<void> {
    if (this.state !== 'new') throw stateConflict();
    this.settings = validateLyriaSettings(settings);
    this.state = 'opened';
  }

  async prepare(initialState: EffectiveState, config: ConnectorConfig): Promise<void> {
    if (this.state !== 'opened' && this.state !== 'stopped') throw stateConflict();
    this.config = validateAndResolveLyriaConfig(config);
    this.preparedState = initialState;
    this.lastModelContext = undefined;
    this.warnedTempos.clear();
    this.flowPaused = false;
    this.promptsNonEmpty = false;
    this.playbackState = 'paused';
    this.state = 'prepared';
  }

  async start(sink: AudioSink, timing: ConnectorTiming, runId: string): Promise<void> {
    if (this.state !== 'prepared' || this.settings === undefined) throw stateConflict();
    const initialState = this.preparedState;
    const config = this.config;
    if (initialState === undefined || config === undefined) throw stateConflict();

    this.state = 'starting';
    this.sink = sink;
    this.timing = timing;
    this.runId = runId;
    this.runActive = true;
    this.setupReceived = false;
    this.terminalFailureReported = false;
    this.startupFailure = undefined;
    this.stopSent = false;
    const token = ++this.sessionToken;

    this.transition = createPromptTransition({
      clock: this.dependencies.clock,
      transitionDurationMs: config.prompt.transitionDurationMs,
      transitionSteps: config.prompt.transitionSteps,
      sender: {
        send: (prompts) => this.sendPrompts(prompts, token, runId),
        requestPlay: () => this.reconcilePlayback(token, runId),
        requestPause: () => this.reconcilePlayback(token, runId)
      },
      onFailure: (failure) => this.reportTerminalFailure(failure, token, runId)
    });
    this.transition.beginRun(runId);

    const setup = deferred<void>();
    const callbackFailure = deferred<never>();
    const timeout = this.dependencies.clock.schedule(
      this.dependencies.clock.now() + this.dependencies.setupTimeoutSeconds,
      () => callbackFailure.reject(connectorError('lyria-setup-timeout', 'network', true))
    );

    try {
      this.client = this.dependencies.createClient(this.clientOptions());
      const connection = this.client
        .connect({
          model: LYRIA_MODEL_ID,
          callbacks: {
            onmessage: (message) =>
              this.handleMessage(message, setup, callbackFailure, token, runId),
            onerror: () =>
              this.handleCallbackFailure(
                connectorError('lyria-network-failure', 'network', true),
                callbackFailure,
                token,
                runId
              ),
            onclose: (event) =>
              this.handleCallbackFailure(
                this.classifyClose(event.code, !this.setupReceived),
                callbackFailure,
                token,
                runId
              )
          }
        })
        .catch(() => {
          throw connectorError('lyria-network-failure', 'network', true);
        });
      this.session = await Promise.race([connection, callbackFailure.promise]);
      await Promise.race([setup.promise, callbackFailure.promise]);
      if (!this.isActive(token, runId)) throw stateConflict();

      const context = this.modelContext(initialState, timing);
      await this.sendModelConfig(context, token, runId);
      this.lastModelContext = context;
      const prompts = translatePrompts(initialState, config.prompt);
      await this.transition.update(prompts);
      if (this.startupFailure !== undefined) throw this.startupFailure;
      if (!this.isActive(token, runId)) throw stateConflict();
      this.state = 'running';
    } catch (error) {
      const failure = safeError(error, connectorError('lyria-startup-failure', 'internal', false));
      this.finishSession(runId, false);
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
    if (this.state !== 'running' || this.timing === undefined || this.config === undefined) {
      throw stateConflict();
    }
    const token = this.sessionToken;
    const runId = this.runId;
    if (runId === undefined || !this.isActive(token, runId)) throw stateConflict();

    const context = this.modelContext(update.state, this.timing);
    if (
      this.lastModelContext === undefined ||
      context.bpm !== this.lastModelContext.bpm ||
      context.scale !== this.lastModelContext.scale
    ) {
      await this.sendModelConfig(context, token, runId);
      this.requireSession(token, runId).resetContext();
      this.lastModelContext = context;
    }

    const prompts = translatePrompts(update.state, this.config.prompt);
    if (this.transition === undefined) throw stateConflict();
    await this.transition.update(prompts);
    return requestedBoundary;
  }

  async setGenerationPaused(paused: boolean): Promise<void> {
    if (this.state !== 'running' || this.runId === undefined) throw stateConflict();
    if (this.flowPaused === paused) return;
    this.flowPaused = paused;
    await this.reconcilePlayback(this.sessionToken, this.runId);
  }

  async stop(runId: string): Promise<void> {
    if (this.state === 'closed') return;
    if (this.runId === undefined || this.runId !== runId) return;
    this.finishSession(runId, true);
    this.state = 'stopped';
  }

  async close(): Promise<void> {
    if (this.state === 'closed') return;
    const activeRunId = this.runId;
    if (activeRunId !== undefined) this.finishSession(activeRunId, true);
    else this.closeSessionBestEffort(false);
    this.settings = undefined;
    this.preparedState = undefined;
    this.config = undefined;
    this.state = 'closed';
  }

  private clientOptions(): LyriaClientOptions {
    const settings = this.settings;
    if (settings === undefined) throw stateConflict();
    if (settings.accessMode === 'byok') {
      return { apiKey: settings.apiKey, apiVersion: LYRIA_API_VERSION };
    }
    return {
      apiKey: HOSTED_SENTINEL,
      apiVersion: LYRIA_API_VERSION,
      httpOptions: { baseUrl: settings.proxyBaseUrl }
    };
  }

  private modelContext(state: EffectiveState, timing: ConnectorTiming): ModelContext {
    const requestedTempo = state.globals.tempo ?? timing.tempo;
    const roundedTempo = Math.round(requestedTempo);
    const bpm = Math.min(200, Math.max(60, roundedTempo));
    if ((requestedTempo < 60 || requestedTempo > 200) && !this.warnedTempos.has(requestedTempo)) {
      this.warnedTempos.add(requestedTempo);
      this.emitWarning('lyria-tempo-clamped');
    }
    const key = state.globals.key ?? timing.key;
    if (key === undefined) return { bpm };
    const classification = classifyKey(key);
    return classification.nativeScale === 'none'
      ? { bpm }
      : { bpm, scale: classification.nativeScale };
  }

  private generationConfig(context: ModelContext): LyriaMusicGenerationConfig {
    const generation = this.config?.generation;
    if (generation === undefined) throw stateConflict();
    return {
      temperature: generation.temperature,
      guidance: generation.guidance,
      topK: generation.topK,
      musicGenerationMode: generation.mode === 'diversity' ? 'DIVERSITY' : 'QUALITY',
      bpm: context.bpm,
      ...(context.scale !== undefined ? { scale: context.scale } : {}),
      ...(generation.muteBass !== undefined ? { muteBass: generation.muteBass } : {}),
      ...(generation.muteDrums !== undefined ? { muteDrums: generation.muteDrums } : {}),
      ...(generation.onlyBassAndDrums !== undefined
        ? { onlyBassAndDrums: generation.onlyBassAndDrums }
        : {}),
      ...(generation.seed !== undefined ? { seed: generation.seed } : {}),
      ...(generation.density !== undefined ? { density: generation.density } : {}),
      ...(generation.brightness !== undefined ? { brightness: generation.brightness } : {})
    };
  }

  private async sendModelConfig(
    context: ModelContext,
    token: number,
    runId: string
  ): Promise<void> {
    try {
      await this.requireSession(token, runId).setMusicGenerationConfig({
        musicGenerationConfig: this.generationConfig(context)
      });
    } catch (error) {
      throw safeError(error, connectorError('lyria-network-failure', 'network', true));
    }
  }

  private async sendPrompts(
    prompts: readonly WeightedPrompt[],
    token: number,
    runId: string
  ): Promise<void> {
    if (prompts.length === 0) {
      this.promptsNonEmpty = false;
      return;
    }
    try {
      await this.requireSession(token, runId).setWeightedPrompts({
        weightedPrompts: prompts.map(({ text, weight }) => ({ text, weight }))
      });
      this.promptsNonEmpty = true;
    } catch (error) {
      throw safeError(error, connectorError('lyria-network-failure', 'network', true));
    }
  }

  private async reconcilePlayback(token: number, runId: string): Promise<void> {
    const session = this.requireSession(token, runId);
    const shouldPlay = this.runActive && this.promptsNonEmpty && !this.flowPaused;
    const nextState = shouldPlay ? 'playing' : 'paused';
    if (nextState === this.playbackState) return;
    try {
      if (shouldPlay) session.play();
      else session.pause();
      this.playbackState = nextState;
      const sink = this.sink;
      if (sink !== undefined && shouldPlay) sink.status('streaming', runId);
      else if (sink !== undefined && this.flowPaused) sink.status('throttled', runId);
    } catch (error) {
      throw safeError(error, connectorError('lyria-network-failure', 'network', true));
    }
  }

  private handleMessage(
    message: LyriaServerMessage,
    setup: Deferred<void>,
    callbackFailure: Deferred<never>,
    token: number,
    runId: string
  ): void {
    if (!this.isActive(token, runId)) return;
    if (message.setupComplete !== undefined) {
      this.setupReceived = true;
      setup.resolve(undefined);
    }
    if (message.filteredPrompt !== undefined) {
      this.emitWarning('lyria-prompt-filtered');
      if (this.state === 'starting') {
        this.handleCallbackFailure(
          connectorError('lyria-filtered-startup', 'provider', true),
          callbackFailure,
          token,
          runId
        );
      }
    }
    if (message.warning !== undefined) this.emitWarning('lyria-provider-warning');

    try {
      for (const chunk of message.serverContent?.audioChunks ?? []) {
        const bytes = decodeBase64Pcm(chunk.data);
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
    } catch (error) {
      const failure = safeError(error, connectorError('lyria-internal-failure', 'internal', false));
      if (this.state === 'starting') {
        this.handleCallbackFailure(failure, callbackFailure, token, runId);
      } else this.reportTerminalFailure(failure, token, runId);
    }
  }

  private handleCallbackFailure(
    failure: ConnectorError,
    startupGate: Deferred<never>,
    token: number,
    runId: string
  ): void {
    if (!this.isActive(token, runId)) return;
    if (this.state === 'starting') {
      this.startupFailure = failure;
      startupGate.reject(failure);
      return;
    }
    this.reportTerminalFailure(failure, token, runId);
  }

  private classifyClose(code: number | undefined, beforeSetup: boolean): ConnectorError {
    if (code === HOSTED_CLOSE_CODE.auth) {
      return connectorError('lyria-auth-rejected', 'auth', false);
    }
    if (code === HOSTED_CLOSE_CODE.quota) {
      return connectorError('lyria-quota-exhausted', 'quota', true);
    }
    if (code === HOSTED_CLOSE_CODE.provider || code === 1002) {
      return connectorError('lyria-provider-failure', 'provider', true);
    }
    if (this.settings?.accessMode === 'byok' && beforeSetup && code === 1008) {
      return connectorError('lyria-auth-rejected', 'auth', false);
    }
    return connectorError('lyria-network-failure', 'network', true);
  }

  private emitWarning(
    code: 'lyria-tempo-clamped' | 'lyria-prompt-filtered' | 'lyria-provider-warning'
  ): void {
    const sink = this.sink;
    if (sink === undefined) return;
    try {
      sink.warning({
        code,
        message: LYRIA_WARNING_MESSAGE,
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
      message: LYRIA_FAILURE_MESSAGE,
      reason: failure.reason,
      runId,
      retryable: failure.retryable
    };
    this.finishSession(runId, false);
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

  private requireSession(token: number, runId: string): LyriaMusicSession {
    if (!this.isActive(token, runId) || this.session === undefined) throw stateConflict();
    return this.session;
  }

  private finishSession(runId: string, sendStop: boolean): void {
    this.transition?.endRun(runId);
    this.runActive = false;
    this.sessionToken++;
    this.closeSessionBestEffort(sendStop);
    this.transition = undefined;
    this.sink = undefined;
    this.timing = undefined;
    this.runId = undefined;
    this.promptsNonEmpty = false;
    this.flowPaused = false;
    this.playbackState = 'paused';
    this.lastModelContext = undefined;
    this.startupFailure = undefined;
  }

  private closeSessionBestEffort(sendStop: boolean): void {
    const session = this.session;
    if (session !== undefined) {
      if (sendStop && !this.stopSent) {
        this.stopSent = true;
        try {
          session.stop();
        } catch {
          // Stop and close are best effort and never expose SDK details.
        }
      }
      try {
        session.close();
      } catch {
        // Stop and close are best effort and never expose SDK details.
      }
    }
    this.session = undefined;
    this.client = undefined;
  }
}

export function createLyriaConnector(): Connector {
  return new LyriaConnector();
}

export function createLyriaConnectorWithDependencies(
  dependencies: LyriaConnectorDependencies
): Connector {
  return new LyriaConnector(dependencies);
}
