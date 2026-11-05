// The renderer turns a loaded document into one connection per Play. It decides
// when a connection opens and ends (rules 1 to 3), writes silence while no track plays (rule 4), and
// pauses the model for rests and backlogs (rule 6). The numbered rules are in
// the GAS 0.4 behaviour contract. It is internal to the session.
import {
  authoredEventSchedule,
  barToTime,
  createTempoSegmentMap,
  effectiveStateAt,
  positionToTime,
  reanchorTempo,
  resolveTiming,
  sectionInstanceAt,
  secondsPerBar,
  timeToBarFraction,
  timeToPosition,
  validateTimeline,
  type ResolvedTiming,
  type TempoSegmentMap
} from '../core/index.js';
import { AldaParseError, parseAlda, toMidi } from '../notation/index.js';
import type {
  AudioChunk,
  CapabilitiesTable,
  ClockTimer,
  Connection,
  Connector,
  ConnectorAudioChunk,
  ConnectorConfig,
  ConnectorConfigProblem,
  ConnectorConfigSchema,
  ConnectorNotation,
  ConnectorTiming,
  ConnectorUpdate,
  DocumentDefaults,
  EffectiveState,
  InputState,
  ModelInfo,
  MonotonicClock,
  MusicalPosition,
  Timeline
} from '../protocol/index.js';
import { isCloseCode } from '../protocol/index.js';
import { applyS16leGain, BufferLedger } from './audio.js';
import {
  BUFFER_HARD_LIMIT_SECONDS,
  BUFFER_OVERFLOW_SECONDS,
  BUFFER_WARNING_SECONDS,
  CONNECTION_CLOSE_TIMEOUT_SECONDS,
  DEFAULT_FIRST_AUDIO_CHUNKS,
  FADE_OUT_SECONDS,
  LOOKAHEAD_CHUNKS,
  MAX_FIRST_AUDIO_TIMEOUT_SECONDS,
  MAX_LOOKAHEAD_SECONDS,
  MIN_FIRST_AUDIO_TIMEOUT_SECONDS,
  RESUME_LEAD_SECONDS
} from './constants.js';
import {
  applyMergePatch,
  cloneJsonObject,
  freezeJson,
  isPlainJsonObject,
  NonJsonValueError
} from './connector-config.js';
import { classifyConnectorFailure, RendererError } from './errors.js';
import type {
  Renderer,
  RendererEventMap,
  RendererFailure,
  RendererUpdateResult,
  RendererWarning
} from './types.js';

/** Comparing clock times that come from sums of chunk durations. */
const EPSILON = 1e-9;

export interface CreateRendererOptions {
  readonly clock: MonotonicClock;
  readonly connector: Connector;
  readonly defaults?: DocumentDefaults;
  /** A patch over the connector's `defaultConfig`. */
  readonly connectorConfig?: ConnectorConfig;
  /**
   * How long a playing track may go without audio before the Play fails: from
   * the connection opening when bar 1 plays, or from a track's entry after a
   * rest. Defaults to three chunk durations, clamped to 2-15 seconds.
   */
  readonly firstAudioTimeoutSeconds?: number;
}

type ListenerMap = {
  [K in keyof RendererEventMap]: Set<(payload: RendererEventMap[K]) => void>;
};

interface LoadedDocument {
  readonly timeline: Timeline;
  readonly schedule: readonly MusicalPosition[];
  inputState: InputState;
  timing: ResolvedTiming;
  tempoMap: TempoSegmentMap;
}

interface CompletedTail {
  readonly startTime: number;
  /** Clock time of the declared end, where the playhead stops. */
  readonly endTime: number;
  readonly tempoMap: TempoSegmentMap;
}

type PauseReason = 'rest' | 'backlog';

interface HeldAudio {
  chunk: ConnectorAudioChunk;
  startTime: number;
  /** Silence GAS wrote, not the model's audio. */
  readonly silent: boolean;
}

/** One Play: its connection, its musical clock and its audio. */
interface Run {
  readonly abort: AbortController;
  connection: Connection | undefined;
  /** `connect()` resolved and Play went ahead. */
  connected: boolean;
  /** Changed input while connecting, to send once the connection opens. */
  inputDirty: boolean;
  startTime: number;
  anchored: boolean;
  holding: boolean;
  firstAudioTimer: ClockTimer | undefined;
  readonly timers: Set<ClockTimer>;
  readonly audioTimers: Set<ClockTimer>;
  /** Rest timers: the pause, the resume, the entry's missing-audio check and the silence filler. */
  readonly restTimers: Set<ClockTimer>;
  loopIteration: number;
  readonly ledger: BufferLedger;
  readonly heldAudio: HeldAudio[];
  /** Clock time where the next chunk goes. */
  audioCursor: number;
  /** Clock time where the audio handed out so far ends. Nothing before it can change. */
  deliveredEnd: number;
  audioSequence: number;
  gain: number;
  tempo: number;
  warnedForBuffer: boolean;
  warnedFormat: boolean;
  /** No track plays from `silentFrom`, until the model's audio comes in at `entryTime`. */
  resting: boolean;
  silentFrom: number | undefined;
  entryTime: number | undefined;
  /** The model was resumed for the entry, so its audio is for the track coming in. */
  resumedForEntry: boolean;
  readonly pauseReasons: Set<PauseReason>;
  paused: boolean;
  /** Set once, by Stop, Close, a failure or the end of the piece. Everything checks it. */
  ended: boolean;
  /** A failure during startup, which `play()` reports. */
  startupFailure: RendererFailure | undefined;
  chain: Promise<void>;
}

export function createRenderer(options: CreateRendererOptions): Renderer {
  return new RendererImpl(options);
}

class RendererImpl implements Renderer {
  private connector: Connector;
  private defaults: DocumentDefaults;
  private connectorConfig: ConnectorConfig;
  private warnedConfigUnvalidated = false;
  private closed = false;
  private loaded: LoadedDocument | undefined;
  private run: Run | undefined;
  // A finished piece is still playing for an app that buffers audio, so its
  // mapping outlives the Play until another Play starts or playback is stopped.
  private completedTail: CompletedTail | undefined;
  private readonly listeners: ListenerMap = {
    audio: new Set(),
    generationPosition: new Set(),
    warning: new Set(),
    ended: new Set()
  };

  constructor(private readonly options: CreateRendererOptions) {
    this.connector = options.connector;
    this.defaults = normalizeDefaults(options.defaults ?? {});
    this.connectorConfig = this.configFor(options.connector, options.connectorConfig);
    // Nobody can listen yet, so the unchecked-config warning waits for the next check.
    this.warnedConfigUnvalidated = false;
  }

  load(timeline: Timeline, inputState: InputState): void {
    this.assertOpen();
    this.assertStopped('load a timeline');
    const validation = validateTimeline(timeline);
    if (!validation.ok) {
      throw new RendererError('invalid-timeline', 'This timeline is invalid.', {
        problems: validation.problems
      });
    }
    if (inputState.timeline !== timeline) {
      throw new RendererError(
        'invalid-timeline',
        'The input state must belong to the timeline being loaded.'
      );
    }
    const timing = resolveTiming(timeline.musicalContext, this.defaults);
    this.completedTail = undefined;
    this.loaded = {
      timeline,
      schedule: authoredEventSchedule(timeline),
      inputState,
      timing,
      tempoMap: createTempoSegmentMap(timing)
    };
  }

  async update(inputState: InputState): Promise<RendererUpdateResult> {
    this.assertOpen();
    const loaded = this.requireLoaded();
    if (inputState.timeline !== loaded.timeline) {
      throw new RendererError(
        'invalid-timeline',
        'The input state must belong to the loaded timeline.'
      );
    }
    loaded.inputState = inputState;
    const run = this.run;
    if (run === undefined) return {};
    if (!run.connected) {
      // The connection gets the state when it opens.
      run.inputDirty = true;
      return {};
    }
    try {
      return await this.serializeUpdate(loaded, run);
    } catch (error) {
      if (error instanceof RendererError) throw error;
      // The run fails through `serialize`; the caller gets the same safe failure.
      const failure = classifyConnectorFailure(error, {
        code: 'generation-failed',
        message: 'The connection could not take the change.',
        reason: 'internal',
        retryable: true
      });
      throw new RendererError('connection-failed', failure.message, { failure });
    }
  }

  private serializeUpdate(loaded: LoadedDocument, run: Run): Promise<RendererUpdateResult> {
    return this.serialize(run, async () => {
      // Before the anchor there is no musical clock to read, so the whole run is
      // still at bar one.
      const anchored = run.anchored;
      const currentPosition = anchored ? this.currentPosition(loaded, run) : { bar: 1 };
      const state = this.deriveAt(loaded, currentPosition, run.loopIteration);
      run.gain = globalGain(state);
      if (anchored) {
        // A tempo change re-anchors at the exact current instant, which is a
        // fractional bar; rounding it to a position would move the change.
        this.applyDerivedTempo(loaded, run, state, this.currentBarFraction(loaded, run));
      } else {
        run.tempo = state.globals.tempo ?? loaded.timing.tempo;
      }
      let requestedPosition =
        !anchored || run.holding
          ? currentPosition
          : timeToPosition(loaded.tempoMap, this.options.clock.now() + this.lookaheadSeconds());
      if (anchored && !run.holding) {
        requestedPosition = this.restForUpdate(loaded, run, requestedPosition) ?? requestedPosition;
      }
      const appliedPosition = await this.requireConnection(run).update(
        this.buildConnectorUpdate(state),
        requestedPosition
      );
      return { requestedPosition, appliedPosition };
    });
  }

  async play(): Promise<void> {
    this.assertOpen();
    this.assertStopped('start playback');
    const loaded = this.requireLoaded();
    this.completedTail = undefined;
    const now = this.options.clock.now();
    const run: Run = {
      abort: new AbortController(),
      connection: undefined,
      connected: false,
      inputDirty: false,
      startTime: now,
      anchored: false,
      holding: false,
      firstAudioTimer: undefined,
      timers: new Set(),
      audioTimers: new Set(),
      restTimers: new Set(),
      loopIteration: 1,
      ledger: new BufferLedger(),
      heldAudio: [],
      audioCursor: now,
      deliveredEnd: now,
      audioSequence: 0,
      gain: 1,
      tempo: loaded.timing.tempo,
      warnedForBuffer: false,
      warnedFormat: false,
      resting: false,
      silentFrom: undefined,
      entryTime: undefined,
      resumedForEntry: false,
      pauseReasons: new Set(),
      paused: false,
      ended: false,
      startupFailure: undefined,
      chain: Promise.resolve()
    };
    this.run = run;

    const initialPosition = { bar: 1 } as const;
    const initialState = this.deriveAt(loaded, initialPosition, run.loopIteration);
    run.gain = globalGain(initialState);
    run.tempo = initialState.globals.tempo ?? loaded.timing.tempo;
    loaded.tempoMap = createTempoSegmentMap({ ...loaded.timing, tempo: run.tempo }, now);

    let connection: Connection;
    try {
      connection = await this.connect(run, initialState, loaded.timing);
    } catch (error) {
      throw this.startupFailed(run, error);
    }
    run.connection = connection;
    if (run.ended) {
      // Stop came between `connect()` resolving and here.
      this.closeInBackground(connection);
      throw this.startupFailed(run, undefined);
    }

    try {
      // Changes made while connecting, and notation, reach the connection
      // before Play resolves. Several changes collapse into one update.
      const state = run.inputDirty
        ? this.deriveAt(loaded, initialPosition, run.loopIteration)
        : initialState;
      run.inputDirty = false;
      run.gain = globalGain(state);
      const update = this.buildConnectorUpdate(state);
      if (state !== initialState || update.notation !== undefined) {
        run.tempo = state.globals.tempo ?? loaded.timing.tempo;
        loaded.tempoMap = createTempoSegmentMap(
          { ...loaded.timing, tempo: run.tempo },
          run.startTime
        );
        // Raced like connect(): Stop never waits on a provider call (rule 2).
        await raceAbort(run.abort.signal, connection.update(update, initialPosition));
      }
    } catch (error) {
      throw this.startupFailed(run, error);
    }
    if (run.ended) throw this.startupFailed(run, undefined);
    run.connected = true;

    if (tracksPlay(this.deriveAt(loaded, initialPosition, run.loopIteration))) {
      // Bar 1 starts at the first audio, so the model's start-up delay doesn't
      // make it late (rule 4).
      this.armFirstAudioTimeout(run);
      this.maybeAnchor(loaded, run);
    } else {
      // Nothing to wait for: bar 1 starts now, in silence.
      this.commitAnchor(loaded, run);
    }
  }

  /**
   * Calls `connect()` and races it against the run's abort, so Stop or Close
   * never waits on a provider call that hangs (rule 2). A connection that
   * arrives after the abort is closed (rule 1).
   */
  private connect(run: Run, state: EffectiveState, timing: ResolvedTiming): Promise<Connection> {
    const signal = run.abort.signal;
    const connecting = (async () =>
      this.connector.connect({
        config: this.connectorConfig,
        state,
        timing: connectorTiming(timing),
        signal,
        onAudio: (chunk) => this.receiveAudio(run, chunk),
        onWarning: (warning) => {
          if (run.ended) return;
          this.emit(
            'warning',
            Object.freeze({
              code: typeof warning.code === 'string' ? warning.code : 'connector-warning',
              message: 'The connector reported a warning.'
            })
          );
        },
        onError: (error) => {
          this.failRun(
            run,
            classifyConnectorFailure(error, {
              code: 'generation-failed',
              message: 'Audio generation failed during playback.',
              reason: 'internal',
              retryable: true
            })
          );
        }
      }))();
    void connecting.then(
      (connection) => {
        if (run.connection !== connection && run.ended) this.closeInBackground(connection);
      },
      () => undefined
    );
    return raceAbort(signal, connecting);
  }

  /** Ends a run whose startup didn't finish, and says why Play rejects. */
  private startupFailed(run: Run, error: unknown): RendererError {
    const cancelled = run.ended && run.startupFailure === undefined;
    if (!run.ended) {
      run.startupFailure = classifyConnectorFailure(error, {
        code: 'connector-unavailable',
        message: 'The connector could not open a connection.',
        reason: 'internal',
        retryable: true
      });
    }
    this.endRun(run);
    if (cancelled) return new RendererError('cancelled', 'Playback stopped before it started.');
    const failure = run.startupFailure!;
    return new RendererError('connection-failed', failure.message, { failure });
  }

  stop(): void {
    if (this.closed) return;
    this.completedTail = undefined;
    const run = this.run;
    if (run !== undefined) this.endRun(run);
  }

  close(): void {
    if (this.closed) return;
    this.stop();
    this.closed = true;
    for (const listeners of Object.values(this.listeners)) listeners.clear();
  }

  setConnector(connector: Connector, config?: ConnectorConfig): void {
    this.assertOpen();
    this.assertStopped('change the connector');
    const connectorConfig = this.configFor(connector, config);
    this.connector = connector;
    this.connectorConfig = connectorConfig;
    this.warnedConfigUnvalidated = false;
    if (this.loaded !== undefined) this.loaded.tempoMap = createTempoSegmentMap(this.loaded.timing);
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
    return this.connector.description.capabilities;
  }

  getModelInfo(): ModelInfo {
    return this.connector.description.model;
  }

  getDefaults(): DocumentDefaults {
    return this.defaults;
  }

  updateDefaults(patch: Partial<DocumentDefaults>): DocumentDefaults {
    this.assertOpen();
    this.assertStopped('update the document defaults');
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

  updateConnectorConfig(patch: ConnectorConfig): ConnectorConfig {
    this.assertOpen();
    this.assertStopped('update the connector configuration');
    const candidate = this.buildConnectorConfig(this.connector, this.connectorConfig, patch);
    this.connectorConfig = freezeJson(candidate);
    return this.connectorConfig;
  }

  getConfigSchema(): ConnectorConfigSchema {
    return this.connector.description.configSchema;
  }

  /**
   * The musical position `seconds` after this Play's anchor, for an app that
   * places buffered audio. Undefined before the last loop boundary, since the map
   * restarts at bar one there. After a finite Play completes it stays capped at
   * the declared end until the next Play or a Stop.
   */
  positionAtSeconds(seconds: number): MusicalPosition | undefined {
    if (!Number.isFinite(seconds)) return undefined;
    const loaded = this.loaded;
    const run = this.run;
    if (loaded !== undefined && run !== undefined && run.anchored && !run.ended) {
      return placeOnMap(loaded.tempoMap, run.startTime + seconds);
    }
    // Audio past the declared end is the tail of the last chunk, not more music.
    const tail = this.completedTail;
    if (tail === undefined) return undefined;
    return placeOnMap(tail.tempoMap, Math.min(tail.startTime + seconds, tail.endTime));
  }

  // --- configuration -------------------------------------------------------

  /** A connector's defaults with `patch` merged over them, checked by the connector. */
  private configFor(connector: Connector, patch?: ConnectorConfig): ConnectorConfig {
    let defaults: ConnectorConfig;
    try {
      defaults = cloneJsonObject(connector.description.defaultConfig);
    } catch {
      throw new RendererError(
        'invalid-configuration',
        'The connector advertised an invalid configuration contract.'
      );
    }
    // A connector whose validator rejects its own defaults is broken in a way
    // nothing downstream can work around.
    const defaultProblems = this.checkConfig(connector, defaults);
    if (defaultProblems.length > 0) {
      throw new RendererError(
        'invalid-configuration',
        'The connector advertised an invalid configuration contract.',
        { problems: defaultProblems }
      );
    }
    const config =
      patch === undefined ? defaults : this.buildConnectorConfig(connector, defaults, patch);
    return freezeJson(config);
  }

  /**
   * Asks the connector to check a configuration; an empty result means valid.
   * `configSchema` is never compiled. A connector without `validateConfig` gets
   * its configuration unchecked, with one warning.
   */
  private checkConfig(
    connector: Connector,
    candidate: ConnectorConfig
  ): readonly ConnectorConfigProblem[] {
    const validate = connector.validateConfig;
    if (validate === undefined) {
      if (!this.warnedConfigUnvalidated) {
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
    let result: ReturnType<typeof validate>;
    try {
      result = validate.call(connector, candidate);
    } catch {
      // A validator that throws has not said the configuration is fine.
      return [
        Object.freeze({
          path: '',
          code: 'validator-failed',
          message: 'The connector could not check this configuration.'
        })
      ];
    }
    if (result.ok) return [];
    // A rejection with no reasons is still a rejection.
    return result.problems.length > 0
      ? result.problems
      : [
          Object.freeze({
            path: '',
            code: 'invalid',
            message: 'The connector rejected this configuration.'
          })
        ];
  }

  private buildConnectorConfig(
    connector: Connector,
    base: ConnectorConfig,
    patch: ConnectorConfig
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
    const problems = this.checkConfig(connector, candidate);
    if (problems.length > 0) {
      throw new RendererError('invalid-configuration', 'The connector configuration is invalid.', {
        problems
      });
    }
    return candidate;
  }

  // --- events and guards ---------------------------------------------------

  private emit<K extends keyof RendererEventMap>(event: K, payload: RendererEventMap[K]): void {
    const listeners = this.listeners[event] as Set<(value: RendererEventMap[K]) => void>;
    for (const listener of [...listeners]) {
      try {
        listener(payload);
      } catch {
        // A listener that throws can't break the renderer. Reporting it as an
        // event would recurse and could expose secrets.
      }
    }
  }

  private warn(warning: RendererWarning): void {
    this.emit('warning', Object.freeze(warning));
  }

  private assertOpen(): void {
    if (this.closed) throw new RendererError('wrong-state', 'The session is closed.');
  }

  private assertStopped(action: string): void {
    if (this.run !== undefined) {
      throw new RendererError('wrong-state', `Stop playback before you ${action}.`);
    }
  }

  private requireLoaded(): LoadedDocument {
    if (this.loaded === undefined) {
      throw new RendererError('wrong-state', 'Load a timeline before you start playback.');
    }
    return this.loaded;
  }

  private requireConnection(run: Run): Connection {
    if (run.connection === undefined) {
      throw new RendererError('wrong-state', 'The connection is not open.');
    }
    return run.connection;
  }

  private deriveAt(loaded: LoadedDocument, position: MusicalPosition, loopIteration: number) {
    return effectiveStateAt(loaded.inputState, position, {
      loopIteration,
      activeSection: sectionInstanceAt(loaded.timeline, position)
    });
  }

  // --- the musical clock ---------------------------------------------------

  /**
   * Arms every authored boundary and the run's own end. `afterTime` is a clock
   * instant, not a bar, because a live tempo change can land mid-bar.
   */
  private scheduleRun(
    loaded: LoadedDocument,
    run: Run,
    afterTime = barToTime(loaded.tempoMap, 1)
  ): void {
    const lookahead = this.lookaheadSeconds();
    for (const position of loaded.schedule) {
      const boundaryTime = positionToTime(loaded.tempoMap, position);
      if (boundaryTime <= afterTime) continue;
      this.schedule(run, Math.max(run.startTime, boundaryTime - lookahead), () => {
        // The musical side happens now; only the provider call waits its turn,
        // so a slow update never delays a rest.
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
        this.reconcileRest(loaded, run, state, positionToTime(loaded.tempoMap, position));
        const update = this.buildConnectorUpdate(state);
        this.enqueue(run, async () => {
          await this.requireConnection(run).update(update, position);
        });
      });
      this.schedule(run, boundaryTime, () => this.emitPosition(position, run));
    }

    if (loaded.timeline.playback.mode === 'finite') {
      const completionTime = barToTime(loaded.tempoMap, loaded.timeline.playback.declaredBars + 1);
      if (completionTime > afterTime) {
        this.schedule(run, completionTime, () => this.completeFiniteRun(run));
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
  private commitAnchor(loaded: LoadedDocument, run: Run): void {
    this.cancelFirstAudioTimer(run);
    this.anchorRun(loaded, run);
    this.emitPosition({ bar: 1 }, run);
    const state = this.deriveAt(loaded, { bar: 1 }, run.loopIteration);
    this.reconcileRest(loaded, run, state, run.startTime);
    this.releaseHeldAudio(run);
    this.scheduleRun(loaded, run);
  }

  /** Anchors once the connection is open and audio has arrived, in either order. */
  private maybeAnchor(loaded: LoadedDocument, run: Run): void {
    if (run.anchored || run.ended || !run.connected) return;
    if (run.heldAudio.length === 0) return;
    this.commitAnchor(loaded, run);
  }

  private anchorRun(loaded: LoadedDocument, run: Run): void {
    const anchor = this.options.clock.now();
    const shift = anchor - run.startTime;
    run.startTime = anchor;
    run.audioCursor += shift;
    run.deliveredEnd = anchor;
    for (const held of run.heldAudio) held.startTime += shift;
    run.anchored = true;
    loaded.tempoMap = createTempoSegmentMap({ ...loaded.timing, tempo: run.tempo }, anchor);
  }

  private armFirstAudioTimeout(run: Run): void {
    if (run.anchored || run.ended) return;
    const deadline = this.options.clock.now() + this.firstAudioTimeoutSeconds();
    run.firstAudioTimer = this.options.clock.schedule(deadline, () => {
      run.firstAudioTimer = undefined;
      if (run.ended || run.anchored) return;
      this.failRun(run, missingAudioFailure());
    });
  }

  private cancelFirstAudioTimer(run: Run): void {
    const timer = run.firstAudioTimer;
    if (timer === undefined) return;
    run.firstAudioTimer = undefined;
    this.options.clock.cancel(timer);
  }

  private firstAudioTimeoutSeconds(): number {
    const requested =
      this.options.firstAudioTimeoutSeconds ??
      this.connector.description.model.chunkDurationSeconds * DEFAULT_FIRST_AUDIO_CHUNKS;
    if (!Number.isFinite(requested)) return MIN_FIRST_AUDIO_TIMEOUT_SECONDS;
    return Math.min(
      MAX_FIRST_AUDIO_TIMEOUT_SECONDS,
      Math.max(MIN_FIRST_AUDIO_TIMEOUT_SECONDS, requested)
    );
  }

  private schedule(
    run: Run,
    deadline: number,
    callback: () => void,
    timers: Set<ClockTimer> = run.timers
  ): void {
    if (deadline <= this.options.clock.now()) {
      if (!run.ended) callback();
      return;
    }
    let timer: ClockTimer;
    timer = this.options.clock.schedule(deadline, () => {
      timers.delete(timer);
      if (!run.ended) callback();
    });
    timers.add(timer);
  }

  private enqueue(run: Run, task: () => Promise<void>): void {
    void this.serialize(run, task).catch(() => undefined);
  }

  /**
   * Runs provider calls one at a time. A call that throws fails the run, unless
   * the run already ended, in which case the error is the old connection's.
   */
  private serialize<T>(run: Run, task: () => Promise<T>): Promise<T> {
    const result = run.chain.then(async () => {
      if (run.ended) {
        throw new RendererError('wrong-state', 'This Play has ended.');
      }
      return task();
    });
    run.chain = result.then(
      () => undefined,
      (error) => {
        if (run.ended || error instanceof RendererError) return;
        this.failRun(
          run,
          classifyConnectorFailure(error, {
            code: 'generation-failed',
            message: 'Audio generation failed during playback.',
            reason: 'internal',
            retryable: true
          })
        );
      }
    );
    return result;
  }

  private async applyLoop(loaded: LoadedDocument, run: Run): Promise<void> {
    if (run.ended) return;
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
    this.reconcileRest(loaded, run, state, this.options.clock.now());
    await this.requireConnection(run).update(this.buildConnectorUpdate(state), position);
    this.emitPosition(position, run);
    this.scheduleRun(loaded, run);
  }

  private async enterHolding(
    loaded: LoadedDocument,
    run: Run,
    position: MusicalPosition
  ): Promise<void> {
    if (run.ended) return;
    this.cancelBoundaryTimers(run);
    const state = this.deriveAt(loaded, position, run.loopIteration);
    run.gain = globalGain(state);
    run.tempo = state.globals.tempo ?? run.tempo;
    await this.requireConnection(run).update(this.buildConnectorUpdate(state), position);
    if (run.ended) return;
    run.holding = true;
    this.emitPosition(position, run);
  }

  private currentPosition(loaded: LoadedDocument, run: Run): MusicalPosition {
    if (run.holding) return { bar: Math.max(1, loaded.timeline.arrangedBars + 1) };
    return timeToPosition(loaded.tempoMap, this.options.clock.now());
  }

  /**
   * The continuous bar coordinate of this instant. Not a `MusicalPosition`: it is
   * for bar arithmetic, above all re-anchoring a tempo change exactly where it
   * happened rather than at the start of the bar it happened in.
   */
  private currentBarFraction(loaded: LoadedDocument, run: Run): number {
    if (run.holding) return Math.max(1, loaded.timeline.arrangedBars + 1);
    return Math.max(1, timeToBarFraction(loaded.tempoMap, this.options.clock.now()));
  }

  private applyDerivedTempo(
    loaded: LoadedDocument,
    run: Run,
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
    if (!run.holding) this.scheduleRun(loaded, run, barToTime(loaded.tempoMap, anchorBar));
    return true;
  }

  private emitPosition(position: MusicalPosition, run: Run): void {
    if (run.ended) return;
    this.emit(
      'generationPosition',
      Object.freeze({
        position: Object.freeze({ ...position }),
        seconds: Math.max(0, this.options.clock.now() - run.startTime),
        loopIteration: run.loopIteration
      })
    );
  }

  // --- ending a Play -------------------------------------------------------

  /**
   * Ends the run at once: no more audio, timers or provider calls. The
   * connection closes in the background (rule 2).
   */
  private endRun(run: Run): void {
    if (this.run === run) this.run = undefined;
    if (run.ended) return;
    run.ended = true;
    run.abort.abort(new RendererError('cancelled', 'Playback stopped before it started.'));
    this.cancelTimers(run);
    for (const held of run.heldAudio) run.ledger.reject(held.chunk.durationSeconds);
    run.heldAudio.length = 0;
    if (run.connection !== undefined) this.closeInBackground(run.connection);
  }

  /** Closes a connection without waiting, and warns if it takes too long. */
  private closeInBackground(connection: Connection): void {
    const closing = (async () => connection.close())();
    void this.withinCloseTimeout(closing).then(
      (released) => {
        if (released || this.closed) return;
        this.warn({
          code: 'connection-close-timeout',
          message: 'The connection did not close in time; GAS moved on without it.'
        });
      },
      () => undefined
    );
  }

  /**
   * Resolves true once `work` settles, or false after the close timeout. Uses
   * wall time, because the audio clock stops while a browser context is suspended.
   */
  private async withinCloseTimeout(work: Promise<void>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), CONNECTION_CLOSE_TIMEOUT_SECONDS * 1000);
    });
    try {
      return await Promise.race([
        work.then(
          () => true as const,
          () => true as const
        ),
        timeout
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ends a finite piece at its declared length. */
  private completeFiniteRun(run: Run): void {
    if (run.ended) return;
    const loaded = this.loaded;
    const playback = loaded?.timeline.playback;
    this.endRun(run);
    if (run.anchored && loaded !== undefined && playback?.mode === 'finite') {
      this.completedTail = {
        startTime: run.startTime,
        endTime: barToTime(loaded.tempoMap, playback.declaredBars + 1),
        tempoMap: loaded.tempoMap
      };
    }
    this.emit('ended', Object.freeze({ reason: 'finished' }));
  }

  /**
   * A failure ends this connection only (rule 3). Before Play resolved, Play
   * rejects with it; after, it is reported once, as `ended`.
   */
  private failRun(run: Run, failure: RendererFailure): void {
    if (run.ended) return;
    const safe: RendererFailure = Object.freeze({
      code: failure.code,
      message: failure.message,
      reason: failure.reason,
      retryable: failure.retryable,
      ...(isCloseCode(failure.closeCode) ? { closeCode: failure.closeCode } : {})
    });
    if (!run.connected) {
      run.startupFailure = safe;
      this.endRun(run);
      return;
    }
    this.endRun(run);
    this.emit('ended', Object.freeze({ reason: 'failed', failure: safe }));
  }

  private cancelTimers(run: Run): void {
    this.cancelFirstAudioTimer(run);
    for (const timers of [run.timers, run.audioTimers, run.restTimers]) {
      for (const timer of timers) this.options.clock.cancel(timer);
      timers.clear();
    }
  }

  private cancelBoundaryTimers(run: Run): void {
    for (const timer of run.timers) this.options.clock.cancel(timer);
    run.timers.clear();
  }

  // --- rests (rule 4) ------------------------------------------------------

  /**
   * Starts or ends a rest when the state at `time` changes whether any track
   * plays. Called for bar 1, each boundary and each loop.
   */
  private reconcileRest(
    loaded: LoadedDocument,
    run: Run,
    state: EffectiveState,
    time: number
  ): void {
    const plays = tracksPlay(state);
    if (!run.resting && !plays) this.enterRest(loaded, run, time);
    else if (run.resting && plays && run.entryTime === undefined) this.planEntry(run, time);
  }

  /**
   * A change from the app while playing. Stopping the last track starts a rest
   * at the requested position. Starting one during a rest brings it in at the
   * first bar line the model can reach in time, which becomes the requested
   * position.
   */
  private restForUpdate(
    loaded: LoadedDocument,
    run: Run,
    requested: MusicalPosition
  ): MusicalPosition | undefined {
    const plays = tracksPlay(this.deriveAt(loaded, requested, run.loopIteration));
    if (!run.resting) {
      if (plays) return undefined;
      // Audio already handed to the player can't be taken back, so the rest
      // starts where it ends. Held model audio from there fades out first.
      let restTime = Math.max(positionToTime(loaded.tempoMap, requested), run.deliveredEnd);
      const heldFromRest = run.heldAudio.some(
        (held) => !held.silent && Math.abs(held.startTime - restTime) < EPSILON
      );
      if (heldFromRest) restTime += FADE_OUT_SECONDS;
      this.enterRest(loaded, run, restTime);
      return timeToPosition(loaded.tempoMap, restTime);
    }
    if (!plays || run.entryTime !== undefined) return undefined;
    const earliest = Math.max(this.options.clock.now() + RESUME_LEAD_SECONDS, run.deliveredEnd);
    let bar = Math.max(1, Math.floor(timeToBarFraction(loaded.tempoMap, earliest)));
    while (barToTime(loaded.tempoMap, bar) < earliest - EPSILON) bar += 1;
    this.planEntry(run, barToTime(loaded.tempoMap, bar));
    return { bar };
  }

  /**
   * No track plays from `time`. Audio the model generated past it is dropped,
   * silence takes over, and the model pauses at `time`. The rest ends at the
   * next authored entry, if there is one.
   */
  private enterRest(loaded: LoadedDocument, run: Run, time: number): void {
    run.resting = true;
    run.silentFrom = time;
    run.entryTime = undefined;
    run.resumedForEntry = false;
    this.dropHeldFrom(run, time, (held) => !held.silent);
    run.audioCursor = Math.min(run.audioCursor, time);
    this.schedule(run, time, () => this.setPauseReason(run, 'rest', true), run.restTimers);
    const entry = this.nextEntry(loaded, run, time);
    if (entry !== undefined) this.planEntry(run, entry);
    this.fillSilence(run);
    this.releaseBacklog(run);
  }

  /** The first authored boundary after `time` where a track plays. */
  private nextEntry(loaded: LoadedDocument, run: Run, time: number): number | undefined {
    for (const position of loaded.schedule) {
      const boundaryTime = positionToTime(loaded.tempoMap, position);
      if (boundaryTime <= time + EPSILON) continue;
      if (tracksPlay(this.deriveAt(loaded, position, run.loopIteration))) return boundaryTime;
    }
    return undefined;
  }

  /**
   * A track comes in at `entry`. Silence runs up to it exactly, the model
   * resumes one lead before it, and from `entry` the track must get audio.
   */
  private planEntry(run: Run, entry: number): void {
    run.entryTime = entry;
    this.dropHeldFrom(run, entry, (held) => held.silent);
    run.audioCursor = Math.min(run.audioCursor, entry);
    this.schedule(
      run,
      Math.max(run.silentFrom ?? entry, entry - RESUME_LEAD_SECONDS),
      () => {
        run.resumedForEntry = true;
        this.setPauseReason(run, 'rest', false);
      },
      run.restTimers
    );
    this.schedule(
      run,
      entry + this.firstAudioTimeoutSeconds(),
      () => {
        if (run.resting && run.entryTime === entry) this.failRun(run, missingAudioFailure());
      },
      run.restTimers
    );
    this.fillSilence(run);
  }

  /** The model's audio arrived for the entry: the rest is over. */
  private finishRest(run: Run): void {
    const entry = run.entryTime!;
    const chunk = this.connector.description.model.chunkDurationSeconds;
    while (run.audioCursor < entry - EPSILON) {
      this.pushSilence(run, Math.min(chunk, entry - run.audioCursor));
    }
    run.audioCursor = Math.max(run.audioCursor, entry);
    run.resting = false;
    run.silentFrom = undefined;
    run.entryTime = undefined;
    run.resumedForEntry = false;
    for (const timer of run.restTimers) this.options.clock.cancel(timer);
    run.restTimers.clear();
  }

  /**
   * Writes silence ahead of the listener while resting: up to one lookahead and
   * one chunk ahead of now, and never past the entry. Silence goes through the
   * same delivery path as model audio, so it shares the sequence.
   */
  private fillSilence(run: Run): void {
    if (!run.resting || run.ended) return;
    const model = this.connector.description.model;
    const chunk = model.chunkDurationSeconds;
    const lookahead = this.lookaheadSeconds();
    const limit = run.entryTime ?? Number.POSITIVE_INFINITY;
    const now = this.options.clock.now();
    const target = Math.min(now + lookahead + chunk, limit);
    while (run.audioCursor < target - EPSILON) {
      const duration = Math.min(chunk, limit - run.audioCursor);
      this.pushSilence(run, duration);
    }
    if (run.audioCursor >= limit - EPSILON) return;
    let next = run.audioCursor - lookahead - chunk;
    if (next <= now) next = now + chunk;
    this.schedule(run, next, () => this.fillSilence(run), run.restTimers);
  }

  private pushSilence(run: Run, duration: number): void {
    const model = this.connector.description.model;
    const start = run.audioCursor;
    run.audioCursor += duration;
    if (model.sampleFormat !== 's16le') {
      this.warnFormat(run, model.sampleFormat);
      return;
    }
    const frames = Math.round(duration * model.sampleRate);
    const silence: ConnectorAudioChunk = {
      bytes: new Uint8Array(frames * model.channels * 2),
      codec: model.codec,
      sampleFormat: model.sampleFormat,
      sampleRate: model.sampleRate,
      channels: model.channels,
      durationSeconds: duration
    };
    run.ledger.receive(duration);
    const held: HeldAudio = { chunk: silence, startTime: start, silent: true };
    run.heldAudio.push(held);
    this.scheduleAudioDelivery(run, held);
  }

  /** Drops held audio of one kind from `time` on, cutting a chunk that crosses it. */
  private dropHeldFrom(run: Run, time: number, matches: (held: HeldAudio) => boolean): void {
    for (const held of [...run.heldAudio]) {
      if (!matches(held)) continue;
      const end = held.startTime + held.chunk.durationSeconds;
      if (end <= time + EPSILON) continue;
      if (held.startTime >= time - EPSILON) {
        run.heldAudio.splice(run.heldAudio.indexOf(held), 1);
        run.ledger.reject(held.chunk.durationSeconds);
        continue;
      }
      const cut = this.cutChunk(run, held.chunk, time - held.startTime, !held.silent);
      run.ledger.reject(held.chunk.durationSeconds - (cut?.durationSeconds ?? 0));
      if (cut === undefined) run.heldAudio.splice(run.heldAudio.indexOf(held), 1);
      else held.chunk = cut;
    }
  }

  /**
   * The first `keep` seconds of an s16le chunk, faded out at the end when it is
   * the model's audio. Other formats can't be cut, so the whole chunk goes.
   */
  private cutChunk(
    run: Run,
    chunk: ConnectorAudioChunk,
    keep: number,
    fade: boolean
  ): ConnectorAudioChunk | undefined {
    if (chunk.sampleFormat !== 's16le') {
      this.warnFormat(run, chunk.sampleFormat);
      return undefined;
    }
    const frameBytes = chunk.channels * 2;
    const frames = Math.min(
      Math.round(keep * chunk.sampleRate),
      Math.floor(chunk.bytes.byteLength / frameBytes)
    );
    if (frames <= 0) return undefined;
    const bytes = chunk.bytes.slice(0, frames * frameBytes);
    if (fade) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const fadeFrames = Math.min(
        frames,
        Math.max(1, Math.round(FADE_OUT_SECONDS * chunk.sampleRate))
      );
      for (let index = 0; index < fadeFrames; index += 1) {
        const frame = frames - fadeFrames + index;
        const gain = (fadeFrames - 1 - index) / fadeFrames;
        for (let channel = 0; channel < chunk.channels; channel += 1) {
          const offset = frame * frameBytes + channel * 2;
          view.setInt16(offset, Math.round(view.getInt16(offset, true) * gain), true);
        }
      }
    }
    return { ...chunk, bytes, durationSeconds: frames / chunk.sampleRate };
  }

  /**
   * Where model audio in [start, end) has to stop because no track plays: the
   * current rest, or an authored boundary into silence that hasn't been
   * reached yet. Audio is released ahead of its time, before that boundary is
   * processed, so it is checked here.
   */
  private silenceWithin(run: Run, start: number, end: number): number | undefined {
    let cut =
      run.silentFrom !== undefined && run.silentFrom < end - EPSILON ? run.silentFrom : undefined;
    const loaded = this.loaded;
    if (loaded === undefined) return cut;
    for (const position of loaded.schedule) {
      const time = positionToTime(loaded.tempoMap, position);
      if (time < start - EPSILON || time >= end - EPSILON) continue;
      if (cut !== undefined && time >= cut) continue;
      if (!tracksPlay(this.deriveAt(loaded, position, run.loopIteration))) cut = time;
    }
    return cut;
  }

  private warnFormat(run: Run, sampleFormat: string): void {
    if (run.warnedFormat) return;
    run.warnedFormat = true;
    this.warn({
      code: 'unsupported-gain-format',
      message: `Silence, gain and cuts need s16le audio, not ${sampleFormat}.`
    });
  }

  // --- pause (rule 6) ------------------------------------------------------

  /**
   * Pauses the model when the first reason appears and resumes it when the last
   * goes. A rest that has started but not reached its resume keeps it paused
   * even before its own reason is added, so a backlog clearing just before a
   * rest doesn't resume it for a moment.
   */
  private setPauseReason(run: Run, reason: PauseReason, on: boolean): void {
    if (on) run.pauseReasons.add(reason);
    else run.pauseReasons.delete(reason);
    const restPending = run.resting && !run.resumedForEntry;
    if (run.pauseReasons.size > 0 && !run.paused) {
      run.paused = true;
      this.enqueue(run, () => this.requireConnection(run).pause());
    } else if (run.pauseReasons.size === 0 && run.paused && !restPending) {
      run.paused = false;
      this.enqueue(run, () => this.requireConnection(run).resume());
    }
  }

  private checkBackpressure(run: Run): void {
    const held = run.ledger.snapshot().heldSeconds;
    if (held >= BUFFER_WARNING_SECONDS && !run.warnedForBuffer) {
      run.warnedForBuffer = true;
      this.warn({ code: 'audio-buffer-high', message: 'Generated audio is waiting for delivery.' });
    }
    if (held < BUFFER_HARD_LIMIT_SECONDS) return;
    if (!run.pauseReasons.has('backlog')) {
      this.warn({
        code: 'generation-paused-backlog',
        message: 'The model is ahead of the listener, so it is paused until they catch up.'
      });
      this.setPauseReason(run, 'backlog', true);
      return;
    }
    if (held >= BUFFER_OVERFLOW_SECONDS) {
      this.failRun(run, {
        code: 'audio-backpressure-overflow',
        message: 'Generated audio exceeded the buffer limit.',
        reason: 'internal',
        retryable: true
      });
    }
  }

  private releaseBacklog(run: Run): void {
    if (!run.pauseReasons.has('backlog')) return;
    if (run.ledger.snapshot().heldSeconds >= BUFFER_WARNING_SECONDS) return;
    this.setPauseReason(run, 'backlog', false);
  }

  // --- audio ---------------------------------------------------------------

  private receiveAudio(run: Run, chunk: ConnectorAudioChunk): void {
    // A chunk belongs to the connection that sent it. Once its Play ended, it's
    // dropped without a word (rule 1).
    if (run.ended) return;
    try {
      run.ledger.receive(chunk.durationSeconds);
    } catch {
      // Throwing back into the callback would only break the provider's own code.
      this.failRun(run, {
        code: 'invalid-audio',
        message: 'The connector delivered audio with an invalid duration.',
        reason: 'provider',
        retryable: false
      });
      return;
    }
    if (run.resting) {
      // Until the resume, audio is what the model generated past the rest.
      if (!run.resumedForEntry || run.entryTime === undefined) {
        run.ledger.reject(chunk.durationSeconds);
        return;
      }
      this.finishRest(run);
    }
    const held: HeldAudio = { chunk, startTime: run.audioCursor, silent: false };
    run.audioCursor += chunk.durationSeconds;
    run.heldAudio.push(held);
    if (run.anchored) this.scheduleAudioDelivery(run, held);
    // commitAnchor releases everything held, including the chunk just pushed.
    else if (this.loaded !== undefined) this.maybeAnchor(this.loaded, run);
    this.checkBackpressure(run);
  }

  private releaseHeldAudio(run: Run): void {
    for (const held of [...run.heldAudio]) this.scheduleAudioDelivery(run, held);
  }

  private scheduleAudioDelivery(run: Run, held: HeldAudio): void {
    const releaseDeadline = held.startTime - this.lookaheadSeconds();
    if (releaseDeadline <= this.options.clock.now()) this.deliverAudio(run, held);
    else this.schedule(run, releaseDeadline, () => this.deliverAudio(run, held), run.audioTimers);
  }

  private deliverAudio(run: Run, held: HeldAudio): void {
    const index = run.heldAudio.indexOf(held);
    if (index < 0 || run.ended) return;
    run.heldAudio.splice(index, 1);
    let chunk = held.chunk;
    if (!held.silent) {
      const end = held.startTime + chunk.durationSeconds;
      const cut = this.silenceWithin(run, held.startTime, end);
      if (cut !== undefined) {
        const kept =
          cut <= held.startTime + EPSILON
            ? undefined
            : this.cutChunk(run, chunk, cut - held.startTime, true);
        run.ledger.reject(chunk.durationSeconds - (kept?.durationSeconds ?? 0));
        if (kept === undefined) {
          this.releaseBacklog(run);
          return;
        }
        chunk = kept;
      }
    }
    let bytes: Uint8Array = new Uint8Array(chunk.bytes);
    if (run.gain !== 1 && !held.silent) {
      if (chunk.sampleFormat === 's16le') bytes = applyS16leGain(bytes, run.gain);
      else this.warnFormat(run, chunk.sampleFormat);
    }
    run.ledger.deliver(chunk.durationSeconds);
    run.deliveredEnd = Math.max(run.deliveredEnd, held.startTime + chunk.durationSeconds);
    const emitted: AudioChunk = Object.freeze({
      ...chunk,
      bytes,
      sequence: run.audioSequence++
    });
    this.emit('audio', emitted);
    this.releaseBacklog(run);
  }

  private buildConnectorUpdate(state: EffectiveState): ConnectorUpdate {
    const notation: ConnectorNotation[] = [];
    for (const track of state.tracks) {
      this.convertNotationSlot(track.trackId, 'notes', track.notes, notation);
      this.convertNotationSlot(track.trackId, 'motif', track.motif, notation);
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
      this.warn({
        code: 'notation-parse-failed',
        message: `${intent} notation for track "${trackId}" could not be converted.`
      });
    }
  }

  private lookaheadSeconds(): number {
    return Math.min(
      this.connector.description.model.chunkDurationSeconds * LOOKAHEAD_CHUNKS,
      MAX_LOOKAHEAD_SECONDS
    );
  }
}

/** Settles with `promise`, or rejects as soon as `signal` aborts. */
function raceAbort<T>(signal: AbortSignal, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    promise.then(resolve, reject);
  });
}

function connectorTiming(timing: ResolvedTiming): ConnectorTiming {
  return {
    tempo: timing.tempo,
    quarterNoteTempo: (timing.tempo * 4) / timing.timeSignature.beatUnit,
    timeSignature: timing.timeSignature,
    ...(timing.key !== undefined ? { key: timing.key } : {}),
    secondsPerBar: secondsPerBar(timing.tempo, timing.timeSignature.beatsPerBar)
  };
}

function missingAudioFailure(): RendererFailure {
  return {
    code: 'generation-failed',
    message: 'The connector produced no audio for a playing track before the timeout.',
    reason: 'provider',
    retryable: true
  };
}

/** Whether any track plays, which decides between the model's audio and silence. */
function tracksPlay(state: EffectiveState): boolean {
  return state.tracks.some((track) => track.active);
}

function placeOnMap(tempoMap: TempoSegmentMap, time: number): MusicalPosition | undefined {
  const origin = tempoMap[0]?.startTime;
  if (origin === undefined || time < origin) return undefined;
  return timeToPosition(tempoMap, time);
}

function normalizeDefaults(defaults: DocumentDefaults): DocumentDefaults {
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
