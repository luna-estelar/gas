import { GoogleGenAI } from '@google/genai';
import type { LiveMusicGenerationConfig } from '@google/genai';
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
} from '@luna-estelar/gas/protocol';
import { ConnectorError } from '@luna-estelar/gas/protocol';
import {
  DEFAULT_LYRIA_RT_CONFIG,
  LYRIA_RT_CONFIG_SCHEMA,
  type LyriaRtConnectorConfig,
  validateAndResolveLyriaRtConfig,
  validateLyriaRtConfig
} from './config.js';
import {
  LYRIA_RT_API_VERSION,
  LYRIA_RT_MODEL_ID,
  PCM_BYTES_PER_FRAME,
  PCM_BYTES_PER_SECOND,
  PCM_CHANNELS,
  PCM_SAMPLE_RATE
} from './constants.js';
import { translatePrompts, type WeightedPrompt } from './prompts.js';
import { classifyKey, type LyriaRtScale } from './scale.js';
import { type LyriaRtConnectorSettings, validateLyriaRtSettings } from './settings.js';
import { createPromptTransition, type PromptTransition } from './transition.js';

type ConnectorState = 'new' | 'opened' | 'prepared' | 'starting' | 'running' | 'stopped' | 'closed';

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

type LyriaRtMusicGenerationConfig = {
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

type ModelContext = { readonly bpm: number; readonly scale?: LyriaRtScale };

const LYRIA_RT_WARNING_MESSAGE = 'The Lyria RealTime connector reported an operational warning.';
const LYRIA_RT_FAILURE_MESSAGE = 'The Lyria RealTime connector stopped audio generation.';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

/** Lyria RealTime support levels for each GAS intent. */
export const LYRIA_RT_CAPABILITIES: CapabilitiesTable = deepFreeze({
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

const LYRIA_RT_DESCRIPTION: ConnectorDescription = deepFreeze({
  id: 'lyria-rt',
  displayName: 'Lyria RealTime',
  capabilities: LYRIA_RT_CAPABILITIES,
  model: {
    connectorId: 'lyria-rt',
    modelId: LYRIA_RT_MODEL_ID,
    displayName: 'Lyria RealTime',
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: PCM_SAMPLE_RATE,
    channels: PCM_CHANNELS,
    chunkDurationSeconds: 2
  },
  configSchema: LYRIA_RT_CONFIG_SCHEMA,
  defaultConfig: DEFAULT_LYRIA_RT_CONFIG,
  supportsFlowControl: true
});

function connectorError(
  code: string,
  reason: 'network' | 'auth' | 'quota' | 'provider' | 'internal',
  retryable: boolean,
  closeCode?: number
): ConnectorError {
  // ConnectorError drops a close code outside 1000-4999 itself, so an absent or
  // nonsensical transport code leaves no own property behind.
  return new ConnectorError({
    code,
    reason,
    retryable,
    ...(closeCode !== undefined ? { closeCode } : {})
  });
}

function stateConflict(): ConnectorError {
  return connectorError('lyria-rt-state-conflict', 'internal', false);
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
  let resolve!: (value: T) => void;
  let reject!: (error: ConnectorError) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
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

const DEFAULT_DEPENDENCIES: LyriaRtConnectorDependencies = {
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
 * One start of one run: everything the provider hands back for it, and every
 * timer it arms. The SDK's callbacks cannot be detached, so they act only while
 * their attempt is the current one.
 */
interface Attempt {
  readonly runId: string;
  readonly sink: AudioSink;
  readonly timing: ConnectorTiming;
  readonly config: LyriaRtConnectorConfig;
  readonly transition: PromptTransition;
  readonly setup: Deferred<void>;
  /** Rejects with whatever ends the attempt first: a failure, the timeout or Stop. */
  readonly startup: Deferred<never>;
  session: LyriaRtMusicSession | undefined;
  /** Ended by Stop or Close rather than by a failure. */
  cancelled: boolean;
  starting: boolean;
  setupReceived: boolean;
  promptsNonEmpty: boolean;
  flowPaused: boolean;
  playbackState: 'paused' | 'playing';
  lastModelContext: ModelContext | undefined;
}

function cancelledStart(): ConnectorError {
  return connectorError('lyria-rt-start-cancelled', 'internal', false);
}

/** Calls into the host's sink. Its exceptions are its own, never the provider's. */
function hostCall(call: () => void): void {
  try {
    call();
  } catch {
    // Host callbacks are isolated and never stringified or logged here.
  }
}

function closeQuietly(session: LyriaRtMusicSession): void {
  try {
    session.close();
  } catch {
    // Stop and close are best effort and never expose SDK details.
  }
}

export class LyriaRtConnector implements Connector {
  private state: ConnectorState = 'new';
  private settings: LyriaRtConnectorSettings | undefined;
  private preparedState: EffectiveState | undefined;
  private config: LyriaRtConnectorConfig | undefined;
  private attempt: Attempt | undefined;
  private readonly warnedTempos = new Set<number>();

  constructor(private readonly dependencies: LyriaRtConnectorDependencies = DEFAULT_DEPENDENCIES) {}

  async describe(): Promise<ConnectorDescription> {
    return LYRIA_RT_DESCRIPTION;
  }

  async open(settings: ConnectorSettings): Promise<void> {
    if (this.state !== 'new') throw stateConflict();
    this.settings = validateLyriaRtSettings(settings);
    this.state = 'opened';
  }

  validateConfig(config: ConnectorConfig): ConnectorConfigValidation {
    return validateLyriaRtConfig(config);
  }

  async prepare(initialState: EffectiveState, config: ConnectorConfig): Promise<void> {
    // The renderer abandons a run stopped during prepare without calling start.
    if (this.state !== 'opened' && this.state !== 'stopped' && this.state !== 'prepared') {
      throw stateConflict();
    }
    this.config = validateAndResolveLyriaRtConfig(config);
    this.preparedState = initialState;
    this.warnedTempos.clear();
    this.state = 'prepared';
  }

  async start(sink: AudioSink, timing: ConnectorTiming, runId: string): Promise<void> {
    if (this.state !== 'prepared' || this.settings === undefined) throw stateConflict();
    const initialState = this.preparedState;
    const config = this.config;
    if (initialState === undefined || config === undefined) throw stateConflict();

    this.state = 'starting';
    const attempt: Attempt = {
      runId,
      sink,
      timing,
      config,
      transition: createPromptTransition({
        clock: this.dependencies.clock,
        transitionDurationMs: config.prompt.transitionDurationMs,
        transitionSteps: config.prompt.transitionSteps,
        sender: {
          send: (prompts) => this.sendPrompts(attempt, prompts),
          requestPlay: () => this.reconcilePlayback(attempt),
          requestPause: () => this.reconcilePlayback(attempt)
        },
        onFailure: (failure) => this.reportTerminalFailure(attempt, failure)
      }),
      setup: deferred<void>(),
      startup: deferred<never>(),
      session: undefined,
      cancelled: false,
      starting: true,
      setupReceived: false,
      promptsNonEmpty: false,
      flowPaused: false,
      playbackState: 'paused',
      lastModelContext: undefined
    };
    this.attempt = attempt;
    attempt.transition.beginRun(runId);

    const clock = this.dependencies.clock;
    const setupTimeout = clock.schedule(clock.now() + this.dependencies.setupTimeoutSeconds, () =>
      attempt.startup.reject(connectorError('lyria-rt-setup-timeout', 'network', true))
    );

    try {
      const client = this.dependencies.createClient(this.clientOptions());
      // The SDK cannot cancel a connect in flight, so a session that lands after
      // its attempt ended is closed on arrival.
      const connected = client
        .connect({
          model: LYRIA_RT_MODEL_ID,
          callbacks: {
            onmessage: (message) => this.handleMessage(attempt, message),
            // ws and browsers always follow an error with a close, and only
            // the close carries the code that classifies it.
            onerror: () => undefined,
            onclose: (event) => this.handleClose(attempt, event.code)
          }
        })
        .then(
          (session) => {
            if (this.attempt === attempt) attempt.session = session;
            else closeQuietly(session);
          },
          () => {
            throw connectorError('lyria-rt-network-failure', 'network', true);
          }
        );
      await Promise.race([connected, attempt.startup.promise]);
      await Promise.race([attempt.setup.promise, attempt.startup.promise]);

      const context = this.modelContext(attempt, initialState);
      await this.sendModelConfig(attempt, context);
      attempt.lastModelContext = context;
      await attempt.transition.update(translatePrompts(initialState, config.prompt));
      attempt.starting = false;
      this.state = 'running';
    } catch (error) {
      const failure = attempt.cancelled
        ? cancelledStart()
        : safeError(error, connectorError('lyria-rt-startup-failure', 'internal', false));
      if (this.attempt === attempt) {
        this.finishAttempt(attempt, false);
        this.state = 'stopped';
      }
      throw failure;
    } finally {
      clock.cancel(setupTimeout);
    }
  }

  async update(
    update: ConnectorUpdate,
    requestedBoundary: MusicalPosition
  ): Promise<MusicalPosition> {
    const attempt = this.attempt;
    if (this.state !== 'running' || attempt === undefined) throw stateConflict();

    const context = this.modelContext(attempt, update.state);
    const last = attempt.lastModelContext;
    if (last === undefined || context.bpm !== last.bpm || context.scale !== last.scale) {
      await this.sendModelConfig(attempt, context);
      attempt.session!.resetContext();
      attempt.lastModelContext = context;
    }

    await attempt.transition.update(translatePrompts(update.state, attempt.config.prompt));
    return requestedBoundary;
  }

  async setGenerationPaused(paused: boolean): Promise<void> {
    const attempt = this.attempt;
    if (this.state !== 'running' || attempt === undefined) throw stateConflict();
    attempt.flowPaused = paused;
    await this.reconcilePlayback(attempt);
  }

  async stop(runId: string): Promise<void> {
    const attempt = this.attempt;
    if (attempt === undefined || attempt.runId !== runId) return;
    attempt.cancelled = true;
    this.finishAttempt(attempt, true);
    this.state = 'stopped';
  }

  async close(): Promise<void> {
    const attempt = this.attempt;
    if (attempt !== undefined) {
      attempt.cancelled = true;
      this.finishAttempt(attempt, true);
    }
    this.settings = undefined;
    this.preparedState = undefined;
    this.config = undefined;
    this.state = 'closed';
  }

  private clientOptions(): LyriaRtClientOptions {
    const settings = this.settings;
    if (settings === undefined) throw stateConflict();
    return {
      apiKey: settings.apiKey,
      apiVersion: LYRIA_RT_API_VERSION,
      ...(settings.endpoint !== undefined ? { httpOptions: { baseUrl: settings.endpoint } } : {})
    };
  }

  // A GAS tempo is beats per minute where a beat is the meter's `beatUnit`, so
  // 120 in 6/8 is 120 eighth notes a minute. Lyria RealTime's `bpm` is an integer count of
  // quarter notes, 60-200, so the meter has to come out of the number before it
  // is sent: without the conversion a 6/8 document would be generated at twice
  // the tempo the renderer's clock assumes, and the two would drift apart.
  private modelContext(attempt: Attempt, state: EffectiveState): ModelContext {
    const { timing } = attempt;
    const requestedTempo = state.globals.tempo ?? timing.tempo;
    const quarterTempo = (requestedTempo * 4) / timing.timeSignature.beatUnit;
    const bpm = Math.min(200, Math.max(60, Math.round(quarterTempo)));
    // Warn on what is actually out of the model's range, keyed on what the author
    // wrote, so the warning fires once for the tempo they can see and change.
    if ((quarterTempo < 60 || quarterTempo > 200) && !this.warnedTempos.has(requestedTempo)) {
      this.warnedTempos.add(requestedTempo);
      this.emitWarning(attempt, 'lyria-rt-tempo-clamped');
    }
    const key = state.globals.key ?? timing.key;
    if (key === undefined) return { bpm };
    const classification = classifyKey(key);
    return classification.nativeScale === 'none'
      ? { bpm }
      : { bpm, scale: classification.nativeScale };
  }

  private generationConfig(
    { generation }: LyriaRtConnectorConfig,
    context: ModelContext
  ): LyriaRtMusicGenerationConfig {
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

  private async sendModelConfig(attempt: Attempt, context: ModelContext): Promise<void> {
    try {
      await attempt.session!.setMusicGenerationConfig({
        musicGenerationConfig: this.generationConfig(attempt.config, context)
      });
    } catch (error) {
      throw safeError(error, connectorError('lyria-rt-network-failure', 'network', true));
    }
  }

  private async sendPrompts(attempt: Attempt, prompts: readonly WeightedPrompt[]): Promise<void> {
    if (prompts.length === 0) {
      attempt.promptsNonEmpty = false;
      return;
    }
    try {
      await attempt.session!.setWeightedPrompts({
        weightedPrompts: prompts.map(({ text, weight }) => ({ text, weight }))
      });
      attempt.promptsNonEmpty = true;
    } catch (error) {
      throw safeError(error, connectorError('lyria-rt-network-failure', 'network', true));
    }
  }

  private async reconcilePlayback(attempt: Attempt): Promise<void> {
    const session = attempt.session!;
    const shouldPlay = attempt.promptsNonEmpty && !attempt.flowPaused;
    const nextState = shouldPlay ? 'playing' : 'paused';
    if (nextState === attempt.playbackState) return;
    try {
      if (shouldPlay) session.play();
      else session.pause();
      attempt.playbackState = nextState;
    } catch (error) {
      throw safeError(error, connectorError('lyria-rt-network-failure', 'network', true));
    }
    if (shouldPlay) hostCall(() => attempt.sink.status('streaming', attempt.runId));
    else if (attempt.flowPaused) hostCall(() => attempt.sink.status('throttled', attempt.runId));
  }

  private handleMessage(attempt: Attempt, message: LyriaRtServerMessage): void {
    if (!this.isCurrent(attempt)) return;
    if (message.setupComplete !== undefined) {
      attempt.setupReceived = true;
      attempt.setup.resolve(undefined);
    }
    if (message.filteredPrompt !== undefined) this.emitWarning(attempt, 'lyria-rt-prompt-filtered');
    if (message.warning !== undefined) this.emitWarning(attempt, 'lyria-rt-provider-warning');

    try {
      for (const chunk of message.serverContent?.audioChunks ?? []) {
        const bytes = decodeBase64Pcm(chunk.data);
        hostCall(() =>
          attempt.sink.push({
            runId: attempt.runId,
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
      this.handleCallbackFailure(
        attempt,
        safeError(error, connectorError('lyria-rt-internal-failure', 'internal', false))
      );
    }
  }

  private handleClose(attempt: Attempt, code: number | undefined): void {
    if (!this.isCurrent(attempt)) return;
    this.handleCallbackFailure(attempt, this.classifyClose(code, !attempt.setupReceived));
  }

  private handleCallbackFailure(attempt: Attempt, failure: ConnectorError): void {
    if (attempt.starting) attempt.startup.reject(failure);
    else this.reportTerminalFailure(attempt, failure);
  }

  /**
   * Classify only the standard close codes, and pass the raw number through as
   * `closeCode` regardless. An application code (4000-4999) belongs to whoever
   * is serving the endpoint, so it is reported as a network failure and left for
   * the host to interpret rather than guessed at here.
   */
  private classifyClose(code: number | undefined, beforeSetup: boolean): ConnectorError {
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

  private emitWarning(
    attempt: Attempt,
    code: 'lyria-rt-tempo-clamped' | 'lyria-rt-prompt-filtered' | 'lyria-rt-provider-warning'
  ): void {
    hostCall(() =>
      attempt.sink.warning({ code, message: LYRIA_RT_WARNING_MESSAGE, runId: attempt.runId })
    );
  }

  private reportTerminalFailure(attempt: Attempt, failure: ConnectorError): void {
    const event: RendererFailure = {
      code: failure.code,
      message: LYRIA_RT_FAILURE_MESSAGE,
      reason: failure.reason,
      runId: attempt.runId,
      retryable: failure.retryable,
      ...(failure.closeCode !== undefined ? { closeCode: failure.closeCode } : {})
    };
    this.finishAttempt(attempt, false);
    this.state = 'stopped';
    hostCall(() => attempt.sink.failure(event));
  }

  private isCurrent(attempt: Attempt): boolean {
    return this.attempt === attempt;
  }

  /**
   * Ends the current attempt, once: settles a startup still waiting on it,
   * cancels its transition, and releases its session.
   */
  private finishAttempt(attempt: Attempt, sendStop: boolean): void {
    this.attempt = undefined;
    attempt.transition.endRun(attempt.runId);
    attempt.startup.reject(stateConflict());
    const session = attempt.session;
    if (session === undefined) return;
    if (sendStop) {
      try {
        session.stop();
      } catch {
        // Stop and close are best effort and never expose SDK details.
      }
    }
    closeQuietly(session);
  }
}

export function createLyriaRtConnector(): Connector {
  return new LyriaRtConnector();
}

export function createLyriaRtConnectorWithDependencies(
  dependencies: LyriaRtConnectorDependencies
): Connector {
  return new LyriaRtConnector(dependencies);
}
