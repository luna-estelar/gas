import {
  applyLoopBoundary,
  authoredEventSchedule,
  effectiveStateAt,
  sectionInstanceAt,
  validateTimeline
} from '@luna-estelar/gas-core';
import { AldaParseError, parseAlda, toMidi } from '@luna-estelar/gas-notation';
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
  ConnectorFailureReason,
  ConnectorNotation,
  ConnectorSettings,
  ConnectorStreamStatus,
  ConnectorUpdate,
  EffectiveState,
  InputState,
  ModelInfo,
  MusicalPosition,
  MonotonicClock,
  PlaybackStatus,
  Renderer,
  RendererDefaults,
  RendererEventMap,
  RendererFailure,
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
import {
  applyMergePatch,
  cloneJsonObject,
  compileConfigSchema,
  freezeJson,
  isPlainJsonObject,
  NonJsonValueError,
  type ConfigValidator
} from './connector-config.js';
import { classifyConnectorFailure, RendererError } from './errors.js';
import {
  barToTime,
  createTempoSegmentMap,
  reanchorTempo,
  resolveTiming,
  timeToBar,
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

type RendererRuntimeOptions = Omit<CreateRendererOptions, 'settings'>;

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
  startTime: number;
  anchored: boolean;
  readonly timers: Set<ClockTimer>;
  readonly audioTimers: Set<ClockTimer>;
  loopIteration: number;
  connectorStartAttempted: boolean;
  connectorStopAttempted: boolean;
  readonly ledger: BufferLedger;
  readonly heldAudio: BufferedAudio[];
  audioCursor: number;
  audioSequence: number;
  gain: number;
  tempo: number;
  warnedForBuffer: boolean;
  throttled: boolean;
  stream: ConnectorStreamStatus | undefined;
  ended: boolean;
  chain: Promise<void>;
}

interface BufferedAudio {
  readonly chunk: ConnectorAudioChunk;
  startTime: number;
}

let fallbackRunSequence = 0;

export async function createRenderer(options: CreateRendererOptions): Promise<Renderer> {
  const { settings, ...runtimeOptions } = options;
  const session = new RendererSession(runtimeOptions);
  await session.initialize(settings ?? {});
  return session;
}

class RendererSession implements Renderer {
  private lifecycle: RendererLifecycle = 'initializing';
  private playback: PlaybackStatus = 'stopped';
  private description: ConnectorDescription | undefined;
  private defaults: RendererDefaults;
  private connectorConfig: ConnectorConfig = Object.freeze({});
  private configValidator: ConfigValidator | undefined;
  private loaded: LoadedDocument | undefined;
  private run: ActiveRun | undefined;
  private readonly listeners: ListenerMap = {
    status: new Set(),
    position: new Set(),
    audio: new Set(),
    warning: new Set(),
    failure: new Set()
  };

  constructor(private readonly options: RendererRuntimeOptions) {
    this.defaults = normalizeDefaults(options.defaults ?? {});
  }

  async initialize(settings: ConnectorSettings): Promise<void> {
    let description: ConnectorDescription;
    try {
      description = await this.options.connector.describe();
    } catch (error) {
      throw this.failInitialization(
        classifyConnectorFailure(error, {
          code: 'connector-unavailable',
          message: 'The renderer could not initialize its connector.',
          reason: 'internal',
          retryable: true
        })
      );
    }

    let validator: ConfigValidator;
    let candidate: ConnectorConfig;
    try {
      validator = compileConfigSchema(description.configSchema);
      const defaults = cloneJsonObject(description.defaultConfig);
      const defaultProblems = validator.validate(defaults);
      if (defaultProblems.length > 0) {
        throw new RendererError(
          'connector-unavailable',
          'The connector advertised an invalid configuration contract.',
          { problems: defaultProblems }
        );
      }
      candidate = defaults;
    } catch (error) {
      const failure = Object.freeze({
        code: 'connector-unavailable',
        message: 'The connector advertised an invalid configuration contract.',
        reason: 'internal' as const,
        retryable: false
      });
      const problems = error instanceof RendererError ? error.problems : undefined;
      throw this.failInitialization(failure, problems);
    }

    if (this.options.connectorConfig !== undefined) {
      try {
        candidate = this.buildConnectorConfig(candidate, this.options.connectorConfig, validator);
      } catch (error) {
        this.lifecycle = 'failed';
        this.playback = 'failed';
        this.emitStatus();
        throw error;
      }
    }

    this.description = description;
    this.configValidator = validator;
    this.connectorConfig = freezeJson(candidate);

    try {
      await this.options.connector.open(settings);
    } catch (error) {
      throw this.failInitialization(
        classifyConnectorFailure(error, {
          code: 'connector-unavailable',
          message: 'The renderer could not initialize its connector.',
          reason: 'internal',
          retryable: true
        })
      );
    }

    this.lifecycle = 'ready';
    this.emitStatus();
  }

  private failInitialization(
    failure: RendererFailure,
    problems?: readonly unknown[]
  ): RendererError {
    this.lifecycle = 'failed';
    this.playback = 'failed';
    this.emit('failure', failure);
    this.emitStatus();
    return new RendererError('connector-unavailable', failure.message, {
      failure,
      ...(problems !== undefined ? { problems } : {})
    });
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
    const loaded = this.requireLoaded();
    if (inputState.timeline !== loaded.timeline) {
      throw new RendererError(
        'invalid-timeline',
        'The renderer input state must belong to the loaded timeline.'
      );
    }
    if (this.playback === 'stopped') {
      loaded.inputState = inputState;
      return {};
    }
    if (this.playback !== 'running' && this.playback !== 'holding') {
      throw new RendererError(
        'renderer-state-conflict',
        'Renderer state can change only while stopped, running, or holding.'
      );
    }
    const run = this.run!;
    try {
      return await this.serialize(run, async () => {
        const currentPosition = this.currentPosition(loaded);
        loaded.inputState = inputState;
        const state = this.deriveAt(loaded, currentPosition, run.loopIteration);
        run.gain = globalGain(state);
        this.applyDerivedTempo(loaded, run, state, currentPosition.bar);
        const requestedPosition =
          this.playback === 'holding'
            ? currentPosition
            : {
                bar: timeToBar(loaded.tempoMap, this.options.clock.now() + this.lookaheadSeconds())
              };
        const appliedPosition = await this.options.connector.update(
          this.buildConnectorUpdate(state, run),
          requestedPosition
        );
        return { requestedPosition, appliedPosition };
      });
    } catch (error) {
      if (error instanceof RendererError) throw error;
      const failure = classifyConnectorFailure(error, {
        code: 'generation-failed',
        message: 'The connector could not apply the renderer state update.',
        reason: 'internal',
        runId: run.id,
        retryable: true
      });
      throw new RendererError('connector-unavailable', failure.message, { failure });
    }
  }

  async start(): Promise<string> {
    this.assertReady();
    this.assertStopped('start playback');
    const loaded = this.requireLoaded();
    const runId = this.createRunId();
    const run: ActiveRun = {
      id: runId,
      startTime: this.options.clock.now(),
      anchored: false,
      timers: new Set(),
      audioTimers: new Set(),
      loopIteration: 1,
      connectorStartAttempted: false,
      connectorStopAttempted: false,
      ledger: new BufferLedger(),
      heldAudio: [],
      audioCursor: this.options.clock.now(),
      audioSequence: 0,
      gain: 1,
      tempo: loaded.timing.tempo,
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
      run.tempo = initialState.globals.tempo ?? loaded.timing.tempo;
      loaded.tempoMap = createTempoSegmentMap(
        { ...loaded.timing, tempo: run.tempo },
        run.startTime
      );
      await this.options.connector.prepare(initialState, this.connectorConfig);
      run.connectorStartAttempted = true;
      await this.options.connector.start(
        this.createAudioSink(run),
        {
          tempo: run.tempo,
          timeSignature: loaded.timing.timeSignature,
          ...(loaded.timing.key !== undefined ? { key: loaded.timing.key } : {}),
          secondsPerBar: (60 / run.tempo) * loaded.timing.timeSignature.beatsPerBar
        },
        runId
      );
      const initialUpdate = this.buildConnectorUpdate(initialState, run);
      if (initialUpdate.notation !== undefined) {
        await this.options.connector.update(initialUpdate, initialPosition);
      }
      if (run.ended) return runId;
      this.anchorRun(loaded, run);
      this.playback = 'running';
      this.emitStatus();
      this.emitPosition(initialPosition, run);
      this.releaseHeldAudio(run);
      this.scheduleRun(loaded, run);
      return runId;
    } catch (error) {
      run.ended = true;
      this.cancelTimers(run);
      this.rejectHeldAudio(run, 'Buffered audio was rejected because renderer startup failed.');
      if (run.connectorStartAttempted) await this.stopConnector(run, true);
      this.lifecycle = 'failed';
      this.playback = 'failed';
      const failure = classifyConnectorFailure(error, {
        code: 'generation-failed',
        message: 'The connector could not start this renderer run.',
        reason: 'internal',
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
    } catch (error) {
      const failure = classifyConnectorFailure(error, {
        code: 'connector-unavailable',
        message: 'The renderer connector could not stop this run cleanly.',
        reason: 'internal',
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
    } catch (error) {
      this.lifecycle = 'failed';
      this.playback = 'failed';
      const failure = classifyConnectorFailure(error, {
        code: 'connector-unavailable',
        message: 'The renderer connector could not close cleanly.',
        reason: 'internal',
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
    const validator = this.configValidator;
    if (validator === undefined) {
      throw new RendererError(
        'renderer-state-conflict',
        'The renderer connector configuration is not available.'
      );
    }
    const candidate = this.buildConnectorConfig(this.connectorConfig, patch, validator);
    this.connectorConfig = freezeJson(candidate);
    return this.connectorConfig;
  }

  private buildConnectorConfig(
    base: ConnectorConfig,
    patch: ConnectorConfig,
    validator: ConfigValidator
  ): ConnectorConfig {
    if (!isPlainJsonObject(patch)) {
      throw new RendererError(
        'invalid-configuration',
        'The connector configuration patch must be a plain JSON object.'
      );
    }
    let patchClone: ConnectorConfig;
    try {
      patchClone = cloneJsonObject(patch);
    } catch (error) {
      if (error instanceof NonJsonValueError) {
        throw new RendererError(
          'invalid-configuration',
          `The connector configuration patch is not plain JSON at "${error.path}".`
        );
      }
      throw error;
    }
    const candidate = applyMergePatch(base, patchClone);
    const problems = validator.validate(candidate);
    if (problems.length > 0) {
      throw new RendererError('invalid-configuration', 'The connector configuration is invalid.', {
        problems
      });
    }
    return candidate;
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

  private scheduleRun(loaded: LoadedDocument, run: ActiveRun, afterBar = 1): void {
    const lookahead = Math.min(
      this.requireDescription().model.chunkDurationSeconds * LOOKAHEAD_CHUNKS,
      MAX_LOOKAHEAD_SECONDS
    );
    for (const position of authoredEventSchedule(loaded.timeline)) {
      if (position.bar <= afterBar) continue;
      const boundaryTime = barToTime(loaded.tempoMap, position.bar);
      this.schedule(run, Math.max(run.startTime, boundaryTime - lookahead), () => {
        this.enqueue(run, async () => {
          const state = this.deriveAt(loaded, position, run.loopIteration);
          run.gain = globalGain(state);
          const tempoChanged = this.applyDerivedTempo(loaded, run, state, position.bar);
          if (tempoChanged) {
            this.schedule(run, barToTime(loaded.tempoMap, position.bar), () =>
              this.emitPosition(position, run)
            );
          }
          await this.options.connector.update(this.buildConnectorUpdate(state, run), position);
        });
      });
      this.schedule(run, boundaryTime, () => this.emitPosition(position, run));
    }

    if (loaded.timeline.playback.mode === 'finite') {
      const completion = { bar: loaded.timeline.playback.declaredBars + 1 };
      if (completion.bar > afterBar) {
        this.schedule(run, barToTime(loaded.tempoMap, completion.bar), () => {
          this.enqueue(run, () => this.completeFiniteRun(run));
        });
      }
    } else if (loaded.timeline.playback.mode === 'loop') {
      const boundary = { bar: loaded.timeline.playback.declaredBars + 1 };
      if (boundary.bar > afterBar) {
        this.schedule(run, barToTime(loaded.tempoMap, boundary.bar), () => {
          this.enqueue(run, () => this.applyLoop(loaded, run));
        });
      }
    } else {
      const holding = { bar: Math.max(1, loaded.timeline.arrangedBars + 1) };
      if (loaded.timeline.arrangedBars === 0) {
        this.enqueue(run, () => this.enterHolding(loaded, run, holding));
      } else if (holding.bar > afterBar) {
        this.schedule(run, barToTime(loaded.tempoMap, holding.bar), () => {
          this.enqueue(run, () => this.enterHolding(loaded, run, holding));
        });
      }
    }
  }

  private anchorRun(loaded: LoadedDocument, run: ActiveRun): void {
    const anchor = this.options.clock.now();
    const shift = anchor - run.startTime;
    run.startTime = anchor;
    run.audioCursor += shift;
    for (const buffered of run.heldAudio) buffered.startTime += shift;
    run.anchored = true;
    loaded.tempoMap = createTempoSegmentMap({ ...loaded.timing, tempo: run.tempo }, anchor);
  }

  private schedule(
    run: ActiveRun,
    deadline: number,
    callback: () => void,
    kind: 'boundary' | 'audio' = 'boundary'
  ): void {
    if (deadline <= this.options.clock.now()) {
      if (!run.ended) callback();
      return;
    }
    const timers = kind === 'audio' ? run.audioTimers : run.timers;
    let timer: ClockTimer;
    timer = this.options.clock.schedule(deadline, () => {
      timers.delete(timer);
      if (!run.ended) callback();
    });
    timers.add(timer);
  }

  private enqueue(run: ActiveRun, task: () => Promise<void>): void {
    void this.serialize(run, task).catch(() => undefined);
  }

  private serialize<T>(run: ActiveRun, task: () => Promise<T>): Promise<T> {
    const result = run.chain.then(async () => {
      if (run.ended) {
        throw new RendererError('renderer-state-conflict', 'This renderer run has ended.');
      }
      return task();
    });
    run.chain = result.then(
      () => undefined,
      (error) => this.failRunFromThrown(run, error)
    );
    return result;
  }

  private async failRunFromThrown(run: ActiveRun, error: unknown): Promise<void> {
    const failure = classifyConnectorFailure(error, {
      code: 'generation-failed',
      message: 'Audio generation failed during playback.',
      reason: 'internal',
      retryable: true
    });
    await this.failRun(
      run,
      failure.code,
      failure.message,
      failure.reason ?? 'internal',
      failure.retryable
    );
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
    message = 'Audio generation failed during playback.',
    reason: ConnectorFailureReason = 'internal',
    retryable = true
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
      reason,
      runId: run.id,
      retryable
    });
    this.emit('failure', failure);
    this.emitStatus();
  }

  private async applyLoop(loaded: LoadedDocument, run: ActiveRun): Promise<void> {
    if (run.ended) return;
    loaded.inputState = applyLoopBoundary(loaded.inputState);
    run.loopIteration += 1;
    const position = { bar: 1 } as const;
    const state = this.deriveAt(loaded, position, run.loopIteration);
    run.gain = globalGain(state);
    run.tempo = state.globals.tempo ?? loaded.timing.tempo;
    loaded.tempoMap = createTempoSegmentMap(
      { ...loaded.timing, tempo: run.tempo },
      this.options.clock.now()
    );
    this.cancelBoundaryTimers(run);
    await this.options.connector.update(this.buildConnectorUpdate(state, run), position);
    this.emitPosition(position, run);
    this.scheduleRun(loaded, run);
  }

  private async enterHolding(
    loaded: LoadedDocument,
    run: ActiveRun,
    position: MusicalPosition
  ): Promise<void> {
    if (run.ended) return;
    this.cancelBoundaryTimers(run);
    const state = this.deriveAt(loaded, position, run.loopIteration);
    run.gain = globalGain(state);
    run.tempo = state.globals.tempo ?? run.tempo;
    await this.options.connector.update(this.buildConnectorUpdate(state, run), position);
    this.playback = 'holding';
    this.emitStatus();
    this.emitPosition(position, run);
  }

  private currentPosition(loaded: LoadedDocument): MusicalPosition {
    if (this.playback === 'holding') {
      return { bar: Math.max(1, loaded.timeline.arrangedBars + 1) };
    }
    return { bar: Math.max(1, timeToBar(loaded.tempoMap, this.options.clock.now())) };
  }

  private applyDerivedTempo(
    loaded: LoadedDocument,
    run: ActiveRun,
    state: EffectiveState,
    anchorBar: number
  ): boolean {
    const tempo = state.globals.tempo ?? loaded.timing.tempo;
    if (tempo === run.tempo) return false;
    loaded.tempoMap = reanchorTempo(
      loaded.tempoMap,
      anchorBar,
      tempo,
      loaded.timing.timeSignature.beatsPerBar
    );
    run.tempo = tempo;
    this.cancelBoundaryTimers(run);
    if (this.playback !== 'holding') this.scheduleRun(loaded, run, anchorBar);
    return true;
  }

  private buildConnectorUpdate(state: EffectiveState, run: ActiveRun): ConnectorUpdate {
    const notation: ConnectorNotation[] = [];
    for (const track of state.tracks) {
      this.convertNotationSlot(track.trackId, 'notes', track.notes, run, notation);
      this.convertNotationSlot(track.trackId, 'motif', track.motif, run, notation);
    }
    return Object.freeze({
      state,
      ...(notation.length > 0 ? { notation: Object.freeze(notation) } : {})
    });
  }

  private convertNotationSlot(
    trackId: string,
    intent: 'notes' | 'motif',
    value: EffectiveState['tracks'][number]['notes'],
    run: ActiveRun,
    output: ConnectorNotation[]
  ): void {
    if (value?.kind !== 'alda') return;
    const support = this.getCapabilities().intents[intent];
    if (support === 'unsupported') return;
    try {
      const events = parseAlda(value.source);
      output.push(
        Object.freeze({
          trackId,
          intent,
          source: value.source,
          midi: toMidi(events)
        })
      );
    } catch (error) {
      if (!(error instanceof AldaParseError)) throw error;
      this.emit(
        'warning',
        Object.freeze({
          code: 'notation-parse-failed',
          message: `${intent} notation for track "${trackId}" could not be converted.`,
          runId: run.id
        })
      );
    }
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
    for (const timer of run.audioTimers) this.options.clock.cancel(timer);
    run.audioTimers.clear();
  }

  private cancelBoundaryTimers(run: ActiveRun): void {
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
      warning: (warning) => {
        if (warning.runId !== undefined && warning.runId !== this.run?.id) return;
        this.emit(
          'warning',
          Object.freeze({
            code: warning.code,
            message: 'The connector reported a renderer warning.',
            ...(warning.runId !== undefined ? { runId: warning.runId } : {})
          })
        );
      },
      failure: (failure) => {
        if (failure.runId !== undefined && failure.runId !== this.run?.id) return;
        this.enqueue(run, () =>
          this.failRun(
            run,
            failure.code,
            'The connector reported an audio generation failure.',
            failure.reason,
            failure.retryable
          )
        );
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
    if (run.anchored) this.scheduleAudioDelivery(run, buffered);
    this.checkBackpressure(run);
  }

  private releaseHeldAudio(run: ActiveRun): void {
    for (const buffered of [...run.heldAudio]) this.scheduleAudioDelivery(run, buffered);
  }

  private scheduleAudioDelivery(run: ActiveRun, buffered: BufferedAudio): void {
    const releaseDeadline = buffered.startTime - this.lookaheadSeconds();
    if (releaseDeadline <= this.options.clock.now()) this.deliverAudio(run, buffered);
    else this.schedule(run, releaseDeadline, () => this.deliverAudio(run, buffered), 'audio');
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

function globalGain(state: EffectiveState): number {
  const level = state.globals.level;
  return level?.kind === 'level' ? level.value : 1;
}
