import {
  applyLoopBoundary,
  authoredEventSchedule,
  barToTime,
  createTempoSegmentMap,
  effectiveStateAt,
  positionToTime,
  reanchorTempo,
  resolveTiming,
  sectionInstanceAt,
  timeToBarFraction,
  timeToPosition,
  validateTimeline,
  type ResolvedTiming,
  type TempoSegmentMap
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
  ConnectorConfigProblem,
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
import { isCloseCode } from '@luna-estelar/gas-protocol';
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
  freezeJson,
  isPlainJsonObject,
  NonJsonValueError
} from './connector-config.js';
import { classifyConnectorFailure, RendererError, type RendererProblem } from './errors.js';
import {
  DEFAULT_FIRST_AUDIO_CHUNKS,
  MAX_FIRST_AUDIO_TIMEOUT_SECONDS,
  MIN_FIRST_AUDIO_TIMEOUT_SECONDS
} from './constants.js';

export interface CreateRendererOptions {
  readonly clock: MonotonicClock;
  readonly connector: Connector;
  readonly settings?: ConnectorSettings;
  readonly defaults?: RendererDefaults;
  readonly connectorConfig?: ConnectorConfig;
  readonly runIdFactory?: () => string;
  /**
   * Check the connector's own `defaultConfig` through its own `validateConfig` at
   * startup. Off by default: the answer is fixed by the connector's build and
   * belongs in its test suite. Connector and renderer tests turn it on.
   */
  readonly checkConnectorContract?: boolean;
  /**
   * When musical time starts. `'first-audio'`, the default, anchors bar one to
   * the arrival of the first audio chunk, so the musical clock and the audible
   * clock agree. `'connector-start'` anchors when `connector.start()` resolves,
   * which for a connector whose start means "session established" begins musical
   * time before any audio exists and leaves every later chunk that much closer to
   * being late.
   */
  readonly anchor?: 'first-audio' | 'connector-start';
  /**
   * How long to wait for the first chunk before failing the run, timed from the
   * moment anchoring becomes possible. Covers a connector that connects and then
   * stays silent; connector setup has its own timeout. Defaults to three chunk
   * durations, clamped to 2-15 seconds.
   */
  readonly firstAudioTimeoutSeconds?: number;
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
  /** `connector.start()` and the initial notation update have both settled. */
  startSettled: boolean;
  firstAudioTimer: ClockTimer | undefined;
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
  private warnedConfigUnvalidated = false;
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

    let candidate: ConnectorConfig;
    try {
      const defaults = cloneJsonObject(description.defaultConfig);
      if (this.options.checkConnectorContract === true) {
        const defaultProblems = this.checkConfig(defaults);
        if (defaultProblems.length > 0) {
          throw new RendererError(
            'connector-unavailable',
            'The connector advertised an invalid configuration contract.',
            { problems: defaultProblems }
          );
        }
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
        candidate = this.buildConnectorConfig(candidate, this.options.connectorConfig);
      } catch (error) {
        this.lifecycle = 'failed';
        this.playback = 'failed';
        this.emitStatus();
        throw error;
      }
    }

    this.description = description;
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
    problems?: readonly RendererProblem[]
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
    if (
      this.playback !== 'running' &&
      this.playback !== 'holding' &&
      this.playback !== 'starting'
    ) {
      throw new RendererError(
        'renderer-state-conflict',
        'Renderer state can change only while stopped, starting, running, or holding.'
      );
    }
    const run = this.run!;
    try {
      return await this.serialize(run, async () => {
        // Before the anchor there is no musical clock to read, so the whole run is
        // still at bar one. A host that changes something in the moment between
        // start() resolving and the first chunk arriving is answered, not refused.
        const anchored = run.anchored;
        const currentPosition = anchored ? this.currentPosition(loaded) : { bar: 1 };
        loaded.inputState = inputState;
        const state = this.deriveAt(loaded, currentPosition, run.loopIteration);
        run.gain = globalGain(state);
        if (anchored) {
          // A tempo change re-anchors at the exact current instant, which is a
          // fractional bar; rounding it to a position would move the change.
          this.applyDerivedTempo(loaded, run, state, this.currentBarFraction(loaded));
        } else {
          // The tempo map is rebuilt from run.tempo when the anchor lands, so
          // recording the tempo is enough here.
          run.tempo = state.globals.tempo ?? run.tempo;
        }
        const requestedPosition =
          !anchored || this.playback === 'holding'
            ? currentPosition
            : timeToPosition(loaded.tempoMap, this.options.clock.now() + this.lookaheadSeconds());
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
      startSettled: false,
      firstAudioTimer: undefined,
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
      // A timeline with no notation sends no initial update, so "both settled"
      // includes the case where there was nothing to send.
      run.startSettled = true;
      if (this.options.anchor === 'connector-start') {
        this.commitAnchor(loaded, run);
        return runId;
      }
      this.armFirstAudioTimeout(run);
      this.maybeAnchor(loaded, run);
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
    const candidate = this.buildConnectorConfig(this.connectorConfig, patch);
    this.connectorConfig = freezeJson(candidate);
    return this.connectorConfig;
  }

  /**
   * Asks the connector to check a configuration. An empty result means valid.
   *
   * The renderer never compiles the advertised `configSchema`: AJV builds its
   * validators with `new Function`, which a browser Content Security Policy
   * without `'unsafe-eval'` blocks. A connector that does not implement
   * `validateConfig` gets its configuration through unchecked, with one warning —
   * which a host can only hear after initialization, since no listener exists
   * before `createRenderer` resolves.
   */
  private checkConfig(candidate: ConnectorConfig): readonly ConnectorConfigProblem[] {
    const validate = this.options.connector.validateConfig;
    if (validate === undefined) {
      if (this.lifecycle === 'ready' && !this.warnedConfigUnvalidated) {
        this.warnedConfigUnvalidated = true;
        this.emit(
          'warning',
          Object.freeze({
            code: 'connector-config-unvalidated',
            message: 'The connector cannot check its own configuration, so it was not checked.'
          })
        );
      }
      return [];
    }
    const result = validate.call(this.options.connector, candidate);
    return result.ok ? [] : result.problems;
  }

  private buildConnectorConfig(base: ConnectorConfig, patch: ConnectorConfig): ConnectorConfig {
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
    const problems = this.checkConfig(candidate);
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

  private emitStatus(extra: { readonly completed?: true } = {}): void {
    const status: RendererStatusEvent = Object.freeze({
      lifecycle: this.lifecycle,
      playback: this.playback,
      ...(this.run !== undefined
        ? {
            runId: this.run.id,
            ...(this.run.stream !== undefined ? { stream: this.run.stream } : {}),
            ...(this.run.throttled || this.run.stream === 'throttled' ? { throttled: true } : {})
          }
        : {}),
      ...(extra.completed === true ? { completed: true } : {})
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

  /**
   * Arms every authored boundary and the run's own end.
   *
   * `afterTime` is where to resume from, as a clock instant rather than a bar: a
   * live tempo change re-arms the schedule from the exact instant it took effect,
   * which is part-way through a bar, and an authored event can sit on a beat. Both
   * compare exactly as times and neither survives being rounded to a bar.
   */
  private scheduleRun(
    loaded: LoadedDocument,
    run: ActiveRun,
    afterTime = barToTime(loaded.tempoMap, 1)
  ): void {
    const lookahead = this.lookaheadSeconds();
    for (const position of authoredEventSchedule(loaded.timeline)) {
      const boundaryTime = positionToTime(loaded.tempoMap, position);
      if (boundaryTime <= afterTime) continue;
      this.schedule(run, Math.max(run.startTime, boundaryTime - lookahead), () => {
        this.enqueue(run, async () => {
          const state = this.deriveAt(loaded, position, run.loopIteration);
          run.gain = globalGain(state);
          const eventBar = timeToBarFraction(
            loaded.tempoMap,
            positionToTime(loaded.tempoMap, position)
          );
          const tempoChanged = this.applyDerivedTempo(loaded, run, state, eventBar);
          if (tempoChanged) {
            this.schedule(run, positionToTime(loaded.tempoMap, position), () =>
              this.emitPosition(position, run)
            );
          }
          await this.options.connector.update(this.buildConnectorUpdate(state, run), position);
        });
      });
      this.schedule(run, boundaryTime, () => this.emitPosition(position, run));
    }

    if (loaded.timeline.playback.mode === 'finite') {
      const completionTime = barToTime(loaded.tempoMap, loaded.timeline.playback.declaredBars + 1);
      if (completionTime > afterTime) {
        this.schedule(run, completionTime, () => {
          this.enqueue(run, () => this.completeFiniteRun(run));
        });
      }
    } else if (loaded.timeline.playback.mode === 'loop') {
      const boundaryTime = barToTime(loaded.tempoMap, loaded.timeline.playback.declaredBars + 1);
      if (boundaryTime > afterTime) {
        this.schedule(run, boundaryTime, () => {
          this.enqueue(run, () => this.applyLoop(loaded, run));
        });
      }
    } else {
      const holding = { bar: Math.max(1, loaded.timeline.arrangedBars + 1) };
      const holdingTime = barToTime(loaded.tempoMap, holding.bar);
      if (loaded.timeline.arrangedBars === 0) {
        this.enqueue(run, () => this.enterHolding(loaded, run, holding));
      } else if (holdingTime > afterTime) {
        this.schedule(run, holdingTime, () => {
          this.enqueue(run, () => this.enterHolding(loaded, run, holding));
        });
      }
    }
  }

  /**
   * Commits bar one to now and starts the run: releases whatever audio was held
   * while waiting, and only then arms the authored schedule, so no boundary can
   * fire against a musical clock that has not started yet.
   */
  private commitAnchor(loaded: LoadedDocument, run: ActiveRun): void {
    this.cancelFirstAudioTimer(run);
    this.anchorRun(loaded, run);
    this.playback = 'running';
    this.emitStatus();
    this.emitPosition({ bar: 1 }, run);
    this.releaseHeldAudio(run);
    this.scheduleRun(loaded, run);
  }

  /**
   * Anchors once both halves are true: startup has settled and audio has arrived.
   * Either can happen first — a connector may push a chunk from inside `start()` —
   * so both entry points call this and the anchor lands at whichever came last.
   * Anchoring earlier than that would credit musical time no listener heard, since
   * nothing is delivered before the anchor exists.
   */
  private maybeAnchor(loaded: LoadedDocument, run: ActiveRun): void {
    if (run.anchored || run.ended || !run.startSettled) return;
    if (run.heldAudio.length === 0) return;
    this.commitAnchor(loaded, run);
  }

  private armFirstAudioTimeout(run: ActiveRun): void {
    if (run.anchored || run.ended) return;
    const deadline = this.options.clock.now() + this.firstAudioTimeoutSeconds();
    run.firstAudioTimer = this.options.clock.schedule(deadline, () => {
      run.firstAudioTimer = undefined;
      if (run.ended || run.anchored) return;
      this.enqueue(run, () =>
        this.failRun(run, {
          code: 'generation-failed',
          message: 'The connector produced no audio before the renderer timeout.',
          reason: 'provider',
          retryable: true
        })
      );
    });
  }

  private cancelFirstAudioTimer(run: ActiveRun): void {
    const timer = run.firstAudioTimer;
    if (timer === undefined) return;
    run.firstAudioTimer = undefined;
    this.options.clock.cancel(timer);
  }

  private firstAudioTimeoutSeconds(): number {
    const requested =
      this.options.firstAudioTimeoutSeconds ??
      this.requireDescription().model.chunkDurationSeconds * DEFAULT_FIRST_AUDIO_CHUNKS;
    if (!Number.isFinite(requested)) return MIN_FIRST_AUDIO_TIMEOUT_SECONDS;
    return Math.min(
      MAX_FIRST_AUDIO_TIMEOUT_SECONDS,
      Math.max(MIN_FIRST_AUDIO_TIMEOUT_SECONDS, requested)
    );
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
    await this.failRun(run, {
      code: failure.code,
      message: failure.message,
      reason: failure.reason ?? 'internal',
      retryable: failure.retryable,
      ...(failure.closeCode !== undefined ? { closeCode: failure.closeCode } : {})
    });
  }

  /**
   * A finite piece reaching its declared length is not the same event as a host
   * stopping playback, so it is reported as one: a terminal status carrying both
   * the run id and `completed`, which is what lets a session tell a piece that
   * finished from one that was stopped. The ordinary `stopped` status follows.
   *
   * `run.ended` is set before the connector is stopped, so a chunk generated
   * during that round trip is rejected rather than accepted into a run that is
   * over.
   */
  private async completeFiniteRun(run: ActiveRun): Promise<void> {
    if (run.ended) return;
    this.playback = 'stopping';
    this.emitStatus();
    run.ended = true;
    this.cancelTimers(run);
    this.rejectHeldAudio(run, 'Buffered audio was rejected when the finite run completed.');
    await this.stopConnector(run, false);
    this.playback = 'stopped';
    this.emitStatus({ completed: true });
    if (this.run === run) this.run = undefined;
    this.emitStatus();
  }

  private async failRun(
    run: ActiveRun,
    {
      code = 'generation-failed',
      message = 'Audio generation failed during playback.',
      reason = 'internal',
      retryable = true,
      closeCode
    }: {
      readonly code?: string;
      readonly message?: string;
      readonly reason?: ConnectorFailureReason;
      readonly retryable?: boolean;
      readonly closeCode?: number;
    } = {}
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
      retryable,
      ...(closeCode !== undefined ? { closeCode } : {})
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

  /**
   * The musical position `seconds` after this run's anchor, through the live tempo
   * map. A host uses it to place what a listener is hearing, which lags the last
   * position event by whatever its own audio path buffers.
   */
  positionAtSeconds(seconds: number): MusicalPosition | undefined {
    const loaded = this.loaded;
    const run = this.run;
    if (loaded === undefined || run === undefined) return undefined;
    if (!run.anchored || run.ended) return undefined;
    if (!Number.isFinite(seconds)) return undefined;
    return timeToPosition(loaded.tempoMap, run.startTime + seconds);
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
    return timeToPosition(loaded.tempoMap, this.options.clock.now());
  }

  /**
   * The continuous bar coordinate of this instant. Not a `MusicalPosition`: it is
   * for bar arithmetic, above all re-anchoring a tempo change exactly where it
   * happened rather than at the start of the bar it happened in.
   */
  private currentBarFraction(loaded: LoadedDocument): number {
    if (this.playback === 'holding') return Math.max(1, loaded.timeline.arrangedBars + 1);
    return Math.max(1, timeToBarFraction(loaded.tempoMap, this.options.clock.now()));
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
    if (this.playback !== 'holding') {
      this.scheduleRun(loaded, run, barToTime(loaded.tempoMap, anchorBar));
    }
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
    this.cancelFirstAudioTimer(run);
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
          this.failRun(run, {
            code: failure.code,
            message: 'The connector reported an audio generation failure.',
            ...(failure.reason !== undefined ? { reason: failure.reason } : {}),
            retryable: failure.retryable,
            // A connector calls this directly, so the range is enforced here
            // rather than trusted.
            ...(isCloseCode(failure.closeCode) ? { closeCode: failure.closeCode } : {})
          })
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
    // commitAnchor releases everything held, including the chunk just pushed.
    else if (this.loaded !== undefined) this.maybeAnchor(this.loaded, run);
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
      this.failRun(run, {
        code: 'audio-backpressure-overflow',
        message: 'Generated audio exceeded the renderer buffer limit.'
      })
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
