import {
  authoredEventSchedule,
  effectiveStateAt,
  sectionInstanceAt,
  validateTimeline
} from '@luna-estelar/gas-core';
import type {
  AudioChunk,
  AudioSink,
  CapabilitiesTable,
  ClockTimer,
  Connector,
  ConnectorAudioChunk,
  ConnectorConfig,
  ConnectorConfigSchema,
  ConnectorDescription,
  ConnectorSettings,
  ConnectorStreamStatus,
  EffectiveState,
  InputState,
  JsonObject,
  JsonValue,
  ModelInfo,
  MusicalPosition,
  MonotonicClock,
  PlaybackStatus,
  Renderer,
  RendererDefaults,
  RendererEventMap,
  RendererLifecycle,
  RendererStatusEvent,
  RendererUpdateResult,
  Timeline
} from '@luna-estelar/gas-protocol';
import { applyS16leGain, BufferLedger } from './audio.js';
import {
  BUFFER_HARD_LIMIT_SECONDS,
  BUFFER_WARNING_SECONDS,
  LOOKAHEAD_CHUNKS,
  MAX_LOOKAHEAD_SECONDS
} from './constants.js';
import { RendererError } from './errors.js';
import {
  barToTime,
  createTempoSegmentMap,
  resolveTiming,
  type ResolvedTiming,
  type TempoSegmentMap
} from './musical-time.js';

export interface CreateRendererOptions {
  readonly clock: MonotonicClock;
  readonly connector: Connector;
  readonly settings?: ConnectorSettings;
  readonly defaults?: RendererDefaults;
  readonly connectorConfig?: ConnectorConfig;
  readonly runIdFactory?: () => string;
}

type ListenerMap = {
  [K in keyof RendererEventMap]: Set<(payload: RendererEventMap[K]) => void>;
};

interface LoadedDocument {
  readonly timeline: Timeline;
  inputState: InputState;
  timing: ResolvedTiming;
  tempoMap: TempoSegmentMap;
}

interface ActiveRun {
  readonly id: string;
  readonly startTime: number;
  readonly timers: Set<ClockTimer>;
  loopIteration: number;
  connectorStartAttempted: boolean;
  connectorStopAttempted: boolean;
  readonly ledger: BufferLedger;
  readonly heldAudio: BufferedAudio[];
  audioCursor: number;
  audioSequence: number;
  gain: number;
  warnedForBuffer: boolean;
  throttled: boolean;
  stream: ConnectorStreamStatus | undefined;
  ended: boolean;
  chain: Promise<void>;
}

interface BufferedAudio {
  readonly chunk: ConnectorAudioChunk;
  readonly startTime: number;
}

let fallbackRunSequence = 0;

export async function createRenderer(options: CreateRendererOptions): Promise<Renderer> {
  const session = new RendererSession(options);
  await session.initialize();
  return session;
}

class RendererSession implements Renderer {
  private lifecycle: RendererLifecycle = 'initializing';
  private playback: PlaybackStatus = 'stopped';
  private description: ConnectorDescription | undefined;
  private defaults: RendererDefaults;
  private connectorConfig: ConnectorConfig;
  private loaded: LoadedDocument | undefined;
  private run: ActiveRun | undefined;
  private readonly listeners: ListenerMap = {
    status: new Set(),
    position: new Set(),
    audio: new Set(),
    warning: new Set(),
    failure: new Set()
  };

  constructor(private readonly options: CreateRendererOptions) {
    this.defaults = normalizeDefaults(options.defaults ?? {});
    this.connectorConfig = freezeJson(options.connectorConfig ?? {});
  }

  async initialize(): Promise<void> {
    try {
      const description = await this.options.connector.describe();
      await this.options.connector.open(this.options.settings ?? {});
      this.description = description;
      this.lifecycle = 'ready';
      this.emitStatus();
    } catch {
      const failure = Object.freeze({
        code: 'connector-unavailable',
        message: 'The renderer could not initialize its connector.',
        reason: 'internal' as const,
        retryable: true
      });
      this.lifecycle = 'failed';
      this.playback = 'failed';
      this.emit('failure', failure);
      this.emitStatus();
      throw new RendererError('connector-unavailable', failure.message, { failure });
    }
  }

  async load(timeline: Timeline, inputState: InputState): Promise<void> {
    this.assertReady();
    this.assertStopped('load a timeline');
    const validation = validateTimeline(timeline);
    if (!validation.ok) {
      throw new RendererError('invalid-timeline', 'The renderer could not load this timeline.', {
        problems: validation.problems
      });
    }
    if (inputState.timeline !== timeline) {
      throw new RendererError(
        'invalid-timeline',
        'The renderer input state must belong to the timeline being loaded.'
      );
    }
    const timing = resolveTiming(timeline.musicalContext, this.defaults);
    const tempoMap = createTempoSegmentMap(timing);
    this.loaded = { timeline, inputState, timing, tempoMap };
  }

  async updateState(inputState: InputState): Promise<RendererUpdateResult> {
    this.assertReady();
    this.assertStopped('replace renderer state');
    if (this.loaded === undefined || inputState.timeline !== this.loaded.timeline) {
      throw new RendererError(
        'invalid-timeline',
        'The renderer input state must belong to the loaded timeline.'
      );
    }
    this.loaded.inputState = inputState;
    return {};
  }

  async start(): Promise<string> {
    this.assertReady();
    this.assertStopped('start playback');
    const loaded = this.requireLoaded();
    const runId = this.createRunId();
    const run: ActiveRun = {
      id: runId,
      startTime: this.options.clock.now(),
      timers: new Set(),
      loopIteration: 1,
      connectorStartAttempted: false,
      connectorStopAttempted: false,
      ledger: new BufferLedger(),
      heldAudio: [],
      audioCursor: this.options.clock.now(),
      audioSequence: 0,
      gain: 1,
      warnedForBuffer: false,
      throttled: false,
      stream: undefined,
      ended: false,
      chain: Promise.resolve()
    };
    loaded.tempoMap = createTempoSegmentMap(loaded.timing, run.startTime);
    this.run = run;
    this.playback = 'starting';
    this.emitStatus();

    try {
      const initialPosition = { bar: 1 } as const;
      const initialState = this.deriveAt(loaded, initialPosition, run.loopIteration);
      run.gain = globalGain(initialState);
      await this.options.connector.prepare(initialState, this.connectorConfig);
      run.connectorStartAttempted = true;
      await this.options.connector.start(
        this.createAudioSink(run),
        {
          tempo: loaded.timing.tempo,
          timeSignature: loaded.timing.timeSignature,
          ...(loaded.timing.key !== undefined ? { key: loaded.timing.key } : {}),
          secondsPerBar: (60 / loaded.timing.tempo) * loaded.timing.timeSignature.beatsPerBar
        },
        runId
      );
      if (run.ended) return runId;
      this.playback = 'running';
      this.emitStatus();
      this.emitPosition(initialPosition, run);
      this.scheduleRun(loaded, run);
      return runId;
    } catch {
      run.ended = true;
      this.cancelTimers(run);
      this.rejectHeldAudio(run, 'Buffered audio was rejected because renderer startup failed.');
      if (run.connectorStartAttempted) await this.stopConnector(run, true);
      this.lifecycle = 'failed';
      this.playback = 'failed';
      const failure = Object.freeze({
        code: 'generation-failed',
        message: 'The connector could not start this renderer run.',
        reason: 'internal' as const,
        runId,
        retryable: true
      });
      this.emit('failure', failure);
      this.emitStatus();
      throw new RendererError('connector-unavailable', failure.message, { failure });
    }
  }

  async stop(): Promise<void> {
    if (this.lifecycle === 'closed') return;
    this.assertReady();
    const run = this.run;
    if (run === undefined || run.ended) {
      this.playback = 'stopped';
      this.emitStatus();
      return;
    }
    this.playback = 'stopping';
    this.emitStatus();
    run.ended = true;
    this.cancelTimers(run);
    this.rejectHeldAudio(run, 'Buffered audio was rejected because playback stopped.');
    await run.chain;
    try {
      await this.stopConnector(run, false);
    } catch {
      const failure = Object.freeze({
        code: 'connector-unavailable',
        message: 'The renderer connector could not stop this run cleanly.',
        reason: 'internal' as const,
        runId: run.id,
        retryable: true
      });
      this.lifecycle = 'failed';
      this.playback = 'failed';
      this.emit('failure', failure);
      this.emitStatus();
      throw new RendererError('connector-unavailable', failure.message, { failure });
    }
    if (this.run === run) this.run = undefined;
    this.playback = 'stopped';
    this.emitStatus();
  }

  async close(): Promise<void> {
    if (this.lifecycle === 'closed') return;
    if (this.lifecycle === 'closing') return;
    if (this.lifecycle === 'failed') {
      await this.closeConnectorBestEffort();
      this.lifecycle = 'closed';
      this.playback = 'stopped';
      this.emitStatus();
      return;
    }
    this.assertReady();
    if (this.playback !== 'stopped') await this.stop();
    this.lifecycle = 'closing';
    this.emitStatus();
    try {
      await this.options.connector.close();
      this.lifecycle = 'closed';
      this.playback = 'stopped';
      this.emitStatus();
    } catch {
      this.lifecycle = 'failed';
      this.playback = 'failed';
      const failure = Object.freeze({
        code: 'connector-unavailable',
        message: 'The renderer connector could not close cleanly.',
        reason: 'internal' as const,
        retryable: false
      });
      this.emit('failure', failure);
      this.emitStatus();
      throw new RendererError('connector-unavailable', failure.message, { failure });
    }
  }

  on<K extends keyof RendererEventMap>(
    event: K,
    listener: (payload: RendererEventMap[K]) => void
  ): () => void {
    const listeners = this.listeners[event] as Set<(payload: RendererEventMap[K]) => void>;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  getCapabilities(): CapabilitiesTable {
    return this.requireDescription().capabilities;
  }

  getModelInfo(): ModelInfo {
    return this.requireDescription().model;
  }

  getDefaults(): RendererDefaults {
    return this.defaults;
  }

  async updateDefaults(patch: Partial<RendererDefaults>): Promise<RendererDefaults> {
    this.assertReady();
    this.assertStopped('update renderer defaults');
    const defaults = normalizeDefaults(mergeDefined(this.defaults, patch));
    if (this.loaded !== undefined) {
      const timing = resolveTiming(this.loaded.timeline.musicalContext, defaults);
      this.loaded.timing = timing;
      this.loaded.tempoMap = createTempoSegmentMap(timing);
    }
    this.defaults = defaults;
    return defaults;
  }

  getConnectorConfig(): ConnectorConfig {
    return this.connectorConfig;
  }

  async updateConnectorConfig(patch: ConnectorConfig): Promise<ConnectorConfig> {
    this.assertReady();
    this.assertStopped('update connector configuration');
    this.connectorConfig = freezeJson({ ...this.connectorConfig, ...patch });
    return this.connectorConfig;
  }

  getConfigSchema(): ConnectorConfigSchema {
    return this.requireDescription().configSchema;
  }

  private emit<K extends keyof RendererEventMap>(event: K, payload: RendererEventMap[K]): void {
    const listeners = this.listeners[event] as Set<(value: RendererEventMap[K]) => void>;
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // Host callbacks are isolated from renderer state transitions. Reporting
        // them through this event surface would recurse and could expose secrets.
      }
    }
  }

  private emitStatus(): void {
    const status: RendererStatusEvent = Object.freeze({
      lifecycle: this.lifecycle,
      playback: this.playback,
      ...(this.run !== undefined
        ? {
            runId: this.run.id,
            ...(this.run.stream !== undefined ? { stream: this.run.stream } : {}),
            ...(this.run.throttled || this.run.stream === 'throttled' ? { throttled: true } : {})
          }
        : {})
    });
    this.emit('status', status);
  }

  private assertReady(): void {
    if (this.lifecycle === 'closed' || this.lifecycle === 'closing') {
      throw new RendererError('renderer-closed', 'The renderer is already closed.');
    }
    if (this.lifecycle !== 'ready') {
      throw new RendererError('renderer-state-conflict', 'The renderer is not ready.');
    }
  }

  private assertStopped(action: string): void {
    if (this.playback !== 'stopped') {
      throw new RendererError('renderer-state-conflict', `Stop playback before you ${action}.`);
    }
  }

  private requireDescription(): ConnectorDescription {
    this.assertReady();
    return this.description!;
  }

  private requireLoaded(): LoadedDocument {
    if (this.loaded === undefined) {
      throw new RendererError(
        'renderer-state-conflict',
        'Load a timeline before you start playback.'
      );
    }
    return this.loaded;
  }

  private deriveAt(loaded: LoadedDocument, position: MusicalPosition, loopIteration: number) {
    return effectiveStateAt(loaded.inputState, position, {
      loopIteration,
      activeSection: sectionInstanceAt(loaded.timeline, position)
    });
  }

  private scheduleRun(loaded: LoadedDocument, run: ActiveRun): void {
    const lookahead = Math.min(
      this.requireDescription().model.chunkDurationSeconds * LOOKAHEAD_CHUNKS,
      MAX_LOOKAHEAD_SECONDS
    );
    for (const position of authoredEventSchedule(loaded.timeline)) {
      if (position.bar <= 1) continue;
      const boundaryTime = barToTime(loaded.tempoMap, position.bar);
      this.schedule(run, Math.max(run.startTime, boundaryTime - lookahead), () => {
        this.enqueue(run, async () => {
          const state = this.deriveAt(loaded, position, run.loopIteration);
          run.gain = globalGain(state);
          await this.options.connector.update({ state }, position);
        });
      });
      this.schedule(run, boundaryTime, () => this.emitPosition(position, run));
    }

    if (loaded.timeline.playback.mode === 'finite') {
      const completion = { bar: loaded.timeline.playback.declaredBars + 1 };
      this.schedule(run, barToTime(loaded.tempoMap, completion.bar), () => {
        this.enqueue(run, () => this.completeFiniteRun(run));
      });
    }
  }

  private schedule(run: ActiveRun, deadline: number, callback: () => void): void {
    let timer: ClockTimer;
    timer = this.options.clock.schedule(deadline, () => {
      run.timers.delete(timer);
      if (!run.ended) callback();
    });
    run.timers.add(timer);
  }

  private enqueue(run: ActiveRun, task: () => Promise<void>): void {
    run.chain = run.chain
      .then(async () => {
        if (!run.ended) await task();
      })
      .catch(() => this.failRun(run));
  }

  private async completeFiniteRun(run: ActiveRun): Promise<void> {
    if (run.ended) return;
    this.playback = 'stopping';
    this.emitStatus();
    this.cancelTimers(run);
    this.rejectHeldAudio(run, 'Buffered audio was rejected when the finite run completed.');
    await this.stopConnector(run, false);
    run.ended = true;
    if (this.run === run) this.run = undefined;
    this.playback = 'stopped';
    this.emitStatus();
  }

  private async failRun(
    run: ActiveRun,
    code = 'generation-failed',
    message = 'Audio generation failed during playback.'
  ): Promise<void> {
    if (run.ended) return;
    run.ended = true;
    this.cancelTimers(run);
    this.rejectHeldAudio(run, 'Buffered audio was rejected after renderer failure.');
    await this.stopConnector(run, true);
    this.lifecycle = 'failed';
    this.playback = 'failed';
    const failure = Object.freeze({
      code,
      message,
      reason: 'internal' as const,
      runId: run.id,
      retryable: true
    });
    this.emit('failure', failure);
    this.emitStatus();
  }

  private emitPosition(position: MusicalPosition, run: ActiveRun): void {
    if (run.ended || this.run !== run) return;
    this.emit(
      'position',
      Object.freeze({
        runId: run.id,
        position: Object.freeze({ ...position }),
        seconds: Math.max(0, this.options.clock.now() - run.startTime),
        loopIteration: run.loopIteration
      })
    );
  }

  private cancelTimers(run: ActiveRun): void {
    for (const timer of run.timers) this.options.clock.cancel(timer);
    run.timers.clear();
  }

  private async stopConnector(run: ActiveRun, bestEffort: boolean): Promise<void> {
    if (run.connectorStopAttempted) return;
    run.connectorStopAttempted = true;
    try {
      await this.options.connector.stop(run.id);
    } catch (error) {
      if (!bestEffort) throw error;
    }
  }

  private createRunId(): string {
    const supplied = this.options.runIdFactory?.();
    if (supplied !== undefined) return supplied;
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid ?? `renderer-run-${++fallbackRunSequence}`;
  }

  private createAudioSink(run: ActiveRun): AudioSink {
    return {
      push: (chunk) => this.receiveAudio(run, chunk),
      status: (status, runId) => {
        if (run.ended || runId !== run.id || this.run !== run) return;
        run.stream = status;
        this.emitStatus();
      },
      warning: (warning) => this.emit('warning', Object.freeze({ ...warning })),
      failure: (failure) => {
        if (failure.runId !== undefined && failure.runId !== this.run?.id) return;
        this.emit('failure', Object.freeze({ ...failure }));
      }
    };
  }

  private receiveAudio(run: ActiveRun, chunk: ConnectorAudioChunk): void {
    run.ledger.receive(chunk.durationSeconds);
    if (run.ended || chunk.runId !== run.id || this.run !== run) {
      run.ledger.reject(chunk.durationSeconds);
      this.emit(
        'warning',
        Object.freeze({
          code: 'stale-audio-rejected',
          message: 'Audio from an ended renderer run was rejected.',
          runId: chunk.runId
        })
      );
      return;
    }

    const buffered: BufferedAudio = { chunk, startTime: run.audioCursor };
    run.audioCursor += chunk.durationSeconds;
    run.heldAudio.push(buffered);
    const releaseDeadline = buffered.startTime - this.lookaheadSeconds();
    if (releaseDeadline <= this.options.clock.now()) this.deliverAudio(run, buffered);
    else this.schedule(run, releaseDeadline, () => this.deliverAudio(run, buffered));
    this.checkBackpressure(run);
  }

  private deliverAudio(run: ActiveRun, buffered: BufferedAudio): void {
    const index = run.heldAudio.indexOf(buffered);
    if (index < 0 || run.ended) return;
    run.heldAudio.splice(index, 1);
    const { chunk } = buffered;
    let bytes: Uint8Array = new Uint8Array(chunk.bytes);
    if (run.gain !== 1) {
      if (chunk.sampleFormat === 's16le') bytes = applyS16leGain(bytes, run.gain);
      else {
        this.emit(
          'warning',
          Object.freeze({
            code: 'unsupported-gain-format',
            message: `Global gain could not be applied to ${chunk.sampleFormat} audio.`,
            runId: run.id
          })
        );
      }
    }
    run.ledger.deliver(chunk.durationSeconds);
    const emitted: AudioChunk = Object.freeze({
      ...chunk,
      bytes,
      sequence: run.audioSequence++
    });
    this.emit('audio', emitted);
    this.maybeResumeGeneration(run);
  }

  private checkBackpressure(run: ActiveRun): void {
    const held = run.ledger.snapshot().heldSeconds;
    if (held >= BUFFER_WARNING_SECONDS && !run.warnedForBuffer) {
      run.warnedForBuffer = true;
      this.emit(
        'warning',
        Object.freeze({
          code: 'audio-buffer-high',
          message: 'Generated audio is waiting for delivery.',
          runId: run.id
        })
      );
    }
    if (held < BUFFER_HARD_LIMIT_SECONDS) return;
    const description = this.requireDescription();
    if (
      description.supportsFlowControl &&
      this.options.connector.setGenerationPaused !== undefined &&
      !run.throttled
    ) {
      run.throttled = true;
      this.emitStatus();
      this.enqueue(run, () => this.options.connector.setGenerationPaused!(true));
      return;
    }
    this.enqueue(run, () =>
      this.failRun(
        run,
        'audio-backpressure-overflow',
        'Generated audio exceeded the renderer buffer limit.'
      )
    );
  }

  private maybeResumeGeneration(run: ActiveRun): void {
    if (!run.throttled || run.ledger.snapshot().heldSeconds >= BUFFER_WARNING_SECONDS) return;
    run.throttled = false;
    this.emitStatus();
    this.enqueue(run, () => this.options.connector.setGenerationPaused!(false));
  }

  private rejectHeldAudio(run: ActiveRun, message: string): void {
    if (run.heldAudio.length === 0) return;
    for (const buffered of run.heldAudio) run.ledger.reject(buffered.chunk.durationSeconds);
    run.heldAudio.length = 0;
    this.emit(
      'warning',
      Object.freeze({ code: 'buffered-audio-rejected', message, runId: run.id })
    );
  }

  private lookaheadSeconds(): number {
    return Math.min(
      this.requireDescription().model.chunkDurationSeconds * LOOKAHEAD_CHUNKS,
      MAX_LOOKAHEAD_SECONDS
    );
  }

  private async closeConnectorBestEffort(): Promise<void> {
    try {
      await this.options.connector.close();
    } catch {
      // A failed renderer is already terminal; closing remains best effort.
    }
  }
}

function normalizeDefaults(defaults: RendererDefaults): RendererDefaults {
  // resolveTiming performs all positivity/finite checks without storing its
  // built-in fallbacks in the editable defaults object.
  resolveTiming(undefined, defaults);
  return Object.freeze({
    ...(defaults.tempo !== undefined ? { tempo: defaults.tempo } : {}),
    ...(defaults.timeSignature !== undefined
      ? { timeSignature: Object.freeze({ ...defaults.timeSignature }) }
      : {}),
    ...(defaults.key !== undefined ? { key: defaults.key } : {})
  });
}

function mergeDefined<T extends object>(current: T, patch: Partial<T>): T {
  const merged = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged as T;
}

function freezeJson<T extends JsonObject>(value: T): T {
  return freezeJsonValue(value) as T;
}

function freezeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => freezeJsonValue(entry)));
  }
  if (value !== null && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJsonValue(entry)]))
    );
  }
  return value;
}

function globalGain(state: EffectiveState): number {
  const level = state.globals.level;
  return level?.kind === 'level' ? level.value : 1;
}
