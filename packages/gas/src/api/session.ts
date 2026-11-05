// The session: the one object an app holds. Core owns state transitions; the
// renderer, internal to the session, owns the connection for each Play. The
// numbered rules are in the GAS 0.4 behaviour contract.

import {
  applyCommand,
  applyCommands,
  applyNewTimeline,
  createInputState,
  validateTimeline,
  warningsForTimeline,
  type AppValuesMode,
  type ApplyCommandOptions,
  type CommandFailure,
  type InputState
} from '../core/index.js';
// Loaded on demand: the compiler pulls in Langium and Chevrotain, which an app
// that only drives a session never needs. Every method that compiles is async.
type LanguageModule = typeof import('../language/index.js');
let languageModule: Promise<LanguageModule> | undefined;
function language(): Promise<LanguageModule> {
  return (languageModule ??= import('../language/index.js'));
}
import type {
  CapabilitiesTable,
  Command,
  CommandWarning,
  CompileResult,
  Connector,
  ConnectorConfig,
  ConnectorConfigSchema,
  DocumentDefaults,
  LoadResult,
  ModelInfo,
  MonotonicClock,
  MusicalPosition,
  Timeline
} from '../protocol/index.js';
import {
  createRenderer,
  RendererError,
  SystemClock,
  type Renderer,
  type RendererEnd,
  type RendererFailure
} from '../renderer/index.js';

export type { CompileResult, LoadResult } from '../protocol/index.js';

import { liveStatementToCommand } from './commands.js';
import { EventHub, type SessionEvent, type SessionEventMap } from './events.js';
import { resolveSource, type SourceInput } from './source.js';
import {
  GasOperationError,
  type AppliedPosition,
  type CommandResult,
  type SubmitLiveCommandsResult,
  type SessionEnded,
  type SessionState,
  type SessionStatus,
  type TrackView
} from './types.js';

export interface CompileOptions {
  readonly name?: string;
  readonly timelineId?: string;
}

// What a new document does with the current app values. Defaults to `'keep'`.
export interface LoadOptions {
  readonly appValues?: AppValuesMode;
}

export interface CreateSessionOptions {
  readonly connector: Connector;
  /** A patch over the connector's `defaultConfig`. */
  readonly connectorConfig?: ConnectorConfig;
  /** Defaults to `performance.now()`. The browser session passes its audio clock. */
  readonly clock?: MonotonicClock;
  /** The tempo, time signature and key for a document that doesn't set them. */
  readonly documentDefaults?: DocumentDefaults;
  /**
   * How long a playing track may go without audio before the Play fails.
   * @internal For tests and the browser session.
   */
  readonly firstAudioTimeoutSeconds?: number;
}

export interface DefineTrackInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

export async function createSession(options: CreateSessionOptions): Promise<GasSession> {
  let renderer: Renderer;
  try {
    renderer = createRenderer({
      clock: options.clock ?? new SystemClock(),
      connector: options.connector,
      ...(options.connectorConfig !== undefined
        ? { connectorConfig: options.connectorConfig }
        : {}),
      ...(options.documentDefaults !== undefined ? { defaults: options.documentDefaults } : {}),
      ...(options.firstAudioTimeoutSeconds !== undefined
        ? { firstAudioTimeoutSeconds: options.firstAudioTimeoutSeconds }
        : {})
    });
  } catch (error) {
    throw fromDefaultsError(error, 'The session could not be created.');
  }
  return new GasSession(renderer);
}

export class GasSession {
  private readonly events = new EventHub();
  private status: SessionStatus = 'stopped';
  private ended: SessionEnded | undefined;
  // Set while a document loads. The load commits a state built before it awaits,
  // so a command accepted in that window would be overwritten; commands and
  // other loads reject until it settles.
  private loading = false;
  private input: InputState | undefined;
  // The Play call allowed to settle the session. Stop and Close clear it, so a
  // start that settles afterwards knows it no longer speaks for the session.
  private pendingPlay: object | undefined;

  /** @internal Use `createSession`. */
  constructor(private readonly renderer: Renderer) {
    renderer.on('audio', (chunk) => this.events.emit('audio', chunk));
    renderer.on('generationPosition', (position) =>
      this.events.emit('generationPosition', position)
    );
    renderer.on('warning', (warning) => this.events.warnPlay(warning));
    renderer.on('ended', (end) => this.onEnded(end));
  }

  // Pure: compiles source to a timeline without touching session or renderer
  // state. A compile error rejects with the diagnostics attached.
  async compileSource(input: SourceInput, options: CompileOptions = {}): Promise<CompileResult> {
    const { text, name } = await resolveSource(input);
    const sourceName = options.name ?? name;
    const lang = await language();
    const result = lang.compileSource(text, {
      ...(sourceName !== undefined ? { name: sourceName } : {}),
      ...(options.timelineId !== undefined ? { timelineId: options.timelineId } : {})
    });
    if (!result.ok) {
      throw new GasOperationError('The GAS source could not be compiled.', {
        kind: 'document',
        diagnostics: result.diagnostics
      });
    }
    return { timeline: result.timeline, diagnostics: result.diagnostics };
  }

  // Compile then commit the timeline while stopped. Atomic: nothing is mutated
  // until the renderer accepts the load, so a failed load leaves the previous
  // document and playback untouched.
  async loadSource(
    input: SourceInput,
    options: CompileOptions & LoadOptions = {}
  ): Promise<LoadResult> {
    const compiled = await this.compileSource(input, options);
    return this.commitTimeline(compiled.timeline, options);
  }

  // Commit a canonical protocol 1.0 timeline. Core validates it before any
  // renderer call; an invalid timeline rejects and leaves the session unchanged.
  async loadTimeline(timeline: Timeline, options: LoadOptions = {}): Promise<LoadResult> {
    const validation = validateTimeline(timeline);
    if (!validation.ok) {
      throw new GasOperationError('The timeline is not valid.', {
        kind: 'document',
        diagnostics: [],
        cause: validation.problems
      });
    }
    return this.commitTimeline(timeline, options);
  }

  private async commitTimeline(timeline: Timeline, options: LoadOptions): Promise<LoadResult> {
    this.ensureOpen();
    if (this.status !== 'stopped') {
      throw new GasOperationError('Stop the session before loading a new document.', {
        kind: 'state'
      });
    }
    if (this.loading) {
      throw new GasOperationError('A document is already loading.', { kind: 'state' });
    }
    this.loading = true;
    try {
      return await this.commitLoading(timeline, options);
    } finally {
      this.loading = false;
    }
  }

  private async commitLoading(timeline: Timeline, options: LoadOptions): Promise<LoadResult> {
    const carried = applyNewTimeline(
      this.input ?? createInputState(timeline),
      timeline,
      options.appValues ?? 'keep',
      this.applyOptions()
    );
    if (!carried.ok) {
      throw new GasOperationError(carried.failure.message, {
        kind: 'command',
        failure: carried.failure
      });
    }
    const next = carried.state;
    // Load the renderer first; only commit once it accepts, so a failure is
    // atomic with respect to the previously loaded document.
    try {
      this.renderer.load(timeline, next);
    } catch (error) {
      throw fromRendererError(error, 'The document could not be loaded.');
    }
    this.input = next;
    this.emitState();
    const capabilities = this.renderer.getCapabilities();
    const warnings = [...carried.warnings, ...warningsForTimeline(timeline, capabilities)].map(
      (warning) => this.events.warn(warning)
    );
    return { warnings };
  }

  defineTrack(track: DefineTrackInput): Promise<CommandResult> {
    return this.runCommand({
      kind: 'defineTrack',
      id: track.id,
      ...(track.name !== undefined ? { name: track.name } : {}),
      ...(track.description !== undefined ? { description: track.description } : {})
    });
  }

  getState(): SessionState {
    return this.snapshot();
  }

  getTracks(): readonly TrackView[] {
    return this.trackViews();
  }

  setGlobalFlavor(value: string): Promise<CommandResult> {
    return this.runCommand({ kind: 'setGlobalFlavor', value });
  }
  setGlobalLevel(value: number): Promise<CommandResult> {
    return this.runCommand({ kind: 'setGlobalLevel', value });
  }
  clearGlobalFlavor(): Promise<CommandResult> {
    return this.runCommand({ kind: 'clearGlobalFlavor' });
  }
  clearGlobalLevel(): Promise<CommandResult> {
    return this.runCommand({ kind: 'clearGlobalLevel' });
  }

  setTrackFlavor(id: string, value: string): Promise<CommandResult> {
    return this.runCommand({ kind: 'setTrackFlavor', trackId: id, value });
  }
  setTrackTimbre(id: string, value: string): Promise<CommandResult> {
    return this.runCommand({ kind: 'setTrackTimbre', trackId: id, value });
  }
  setTrackLevel(id: string, value: number): Promise<CommandResult> {
    return this.runCommand({ kind: 'setTrackLevel', trackId: id, value });
  }
  clearTrackFlavor(id: string): Promise<CommandResult> {
    return this.runCommand({ kind: 'clearTrackFlavor', trackId: id });
  }
  clearTrackTimbre(id: string): Promise<CommandResult> {
    return this.runCommand({ kind: 'clearTrackTimbre', trackId: id });
  }
  clearTrackLevel(id: string): Promise<CommandResult> {
    return this.runCommand({ kind: 'clearTrackLevel', trackId: id });
  }
  clearTrackNotes(id: string): Promise<CommandResult> {
    return this.runCommand({ kind: 'clearTrackNotes', trackId: id });
  }
  clearTrackMotif(id: string): Promise<CommandResult> {
    return this.runCommand({ kind: 'clearTrackMotif', trackId: id });
  }
  clearTrackPlay(id: string): Promise<CommandResult> {
    return this.runCommand({ kind: 'clearTrackPlay', trackId: id });
  }
  removeTrack(id: string): Promise<CommandResult> {
    return this.runCommand({ kind: 'removeTrack', trackId: id });
  }

  playTrack(id: string): Promise<CommandResult> {
    return this.runCommand({ kind: 'playTrack', trackId: id });
  }
  stopTrack(id: string): Promise<CommandResult> {
    return this.runCommand({ kind: 'stopTrack', trackId: id });
  }

  setTempo(bpm: number): Promise<CommandResult> {
    return this.runCommand({ kind: 'setTempo', bpm });
  }
  clearTempo(): Promise<CommandResult> {
    return this.runCommand({ kind: 'clearTempo' });
  }

  // Applies a group of commands fully or not at all, then forwards the state to
  // the renderer once.
  async apply(commands: readonly Command[]): Promise<CommandResult> {
    const state = this.requireCommandInput();
    const result = applyCommands(state, commands, this.applyOptions());
    if (!result.ok) {
      throw new GasOperationError(result.failure.message, {
        kind: 'command',
        failure: result.failure
      });
    }
    return this.commit(result.state, result.warnings);
  }

  // Removes every app track and app value. The document stays loaded.
  async clearAppValues(): Promise<CommandResult> {
    const state = this.requireCommandInput();
    return this.commit(createInputState(state.timeline), []);
  }

  // Parse the whole submission first (a structural error rejects everything),
  // then apply the statements in order on a working copy. Any failure rejects
  // and nothing applies. Statements are converted one at a time because a name
  // may refer to a track declared earlier in the same submission.
  async submitLiveCommands(input: SourceInput): Promise<SubmitLiveCommandsResult> {
    // Checked up front so an unloaded or closed session fails before any work,
    // and so those errors keep precedence over a parse error.
    this.ensureOpen();
    this.requireInput();
    const { text } = await resolveSource(input);
    const parsed = (await language()).parseLiveCommands(text);
    if (!parsed.ok) {
      throw new GasOperationError('The live commands could not be parsed.', {
        kind: 'command',
        diagnostics: parsed.diagnostics
      });
    }

    // Read the state only after the awaits above: a programmatic command may have
    // committed in the meantime, and a stale snapshot would discard it on the
    // write below. Nothing from here to `this.input = state` yields.
    let state = this.requireCommandInput();

    const options = this.applyOptions();
    const coreWarnings: CommandWarning[] = [];
    let failure: CommandFailure | undefined;

    for (const statement of parsed.statements) {
      const command = liveStatementToCommand(statement, state);
      const result = applyCommand(state, command, options);
      if (!result.ok) {
        failure = result.failure;
        break;
      }
      state = result.state;
      coreWarnings.push(...result.warnings);
    }

    if (failure !== undefined) {
      throw new GasOperationError(failure.message, { kind: 'command', failure });
    }

    const applied = parsed.statements.length;
    if (applied === 0) {
      return { applied, warnings: [] };
    }
    const { warnings, ...positions } = await this.commit(state, coreWarnings);
    return { applied, warnings, ...positions };
  }

  /**
   * Opens a connection and resolves once it is open (rules 1 and 2). Rejects
   * with `provider` if startup fails, which is the only report of that failure,
   * or with `cancelled` if Stop or Close came first.
   */
  async play(): Promise<void> {
    this.ensureOpen();
    if (this.input === undefined) {
      throw new GasOperationError('Load a document before playing.', { kind: 'state' });
    }
    if (this.loading) {
      throw new GasOperationError('Wait for the document to finish loading.', { kind: 'state' });
    }
    if (this.status !== 'stopped') {
      throw new GasOperationError('The session is already playing.', { kind: 'state' });
    }
    const attempt = {};
    this.pendingPlay = attempt;
    this.setStatus('starting');
    try {
      await this.renderer.play();
    } catch (error) {
      if (this.pendingPlay !== attempt) throw cancelled(error);
      this.pendingPlay = undefined;
      this.ended = 'failed';
      this.setStatus('stopped');
      throw fromRendererError(error, 'The connection could not be opened.');
    }
    if (this.pendingPlay !== attempt) throw cancelled();
    this.pendingPlay = undefined;
    this.setStatus('playing');
  }

  /**
   * Silences queued audio and returns without waiting on the provider (rule 2).
   * Safe while stopped.
   */
  async stop(): Promise<void> {
    this.ensureOpen();
    if (this.status === 'stopped') {
      // A finished piece may still be playing out its tail. Stop silences it.
      if (this.ended !== 'finished') return;
      this.ended = 'stopped';
      this.emitState();
      this.renderer.stop();
      return;
    }
    this.pendingPlay = undefined;
    this.ended = 'stopped';
    this.setStatus('stopped');
    this.renderer.stop();
  }

  async close(): Promise<void> {
    if (this.status === 'closed') return;
    this.pendingPlay = undefined;
    this.renderer.close();
    this.setStatus('closed');
    this.events.clear();
  }

  on<K extends SessionEvent>(
    event: K,
    listener: (payload: SessionEventMap[K]) => void
  ): () => void {
    return this.events.on(event, listener);
  }

  getCapabilities(): CapabilitiesTable {
    return this.renderer.getCapabilities();
  }

  getModelInfo(): ModelInfo {
    return this.renderer.getModelInfo();
  }

  getConnectorConfig(): ConnectorConfig {
    return this.renderer.getConnectorConfig();
  }

  getConfigSchema(): ConnectorConfigSchema {
    return this.renderer.getConfigSchema();
  }

  /** The config is read when a connection opens, so it changes only while stopped. */
  async updateConnectorConfig(patch: ConnectorConfig): Promise<ConnectorConfig> {
    this.requireStopped('change the connector config');
    try {
      return this.renderer.updateConnectorConfig(patch);
    } catch (error) {
      throw fromRendererError(error, 'The connector config is not valid.');
    }
  }

  getDocumentDefaults(): DocumentDefaults {
    return this.renderer.getDefaults();
  }

  async updateDocumentDefaults(patch: Partial<DocumentDefaults>): Promise<DocumentDefaults> {
    this.requireStopped('change the document defaults');
    try {
      return this.renderer.updateDefaults(patch);
    } catch (error) {
      throw fromDefaultsError(error, 'The document defaults are not valid.');
    }
  }

  /**
   * Swaps the connector while stopped. `config` is a patch over the new
   * connector's defaults; the old config isn't carried over. App values stay.
   */
  async setConnector(connector: Connector, config?: ConnectorConfig): Promise<void> {
    this.requireStopped('change the connector');
    try {
      this.renderer.setConnector(connector, config);
    } catch (error) {
      throw fromRendererError(error, 'The new connector refused the config.');
    }
  }

  /**
   * The musical position `seconds` after bar 1 of the current Play.
   * @internal For the browser session's playhead.
   */
  positionAtSeconds(seconds: number): MusicalPosition | undefined {
    return this.renderer.positionAtSeconds(seconds);
  }

  // A Play the renderer ended itself: the piece finished, or the connection
  // failed (rule 3). Stop is the session's own doing and never arrives here.
  private onEnded(end: RendererEnd): void {
    if (this.status !== 'playing') return;
    if (end.reason === 'failed') {
      this.events.emit('error', providerError(end.failure));
      this.ended = 'failed';
    } else {
      this.ended = 'finished';
    }
    this.setStatus('stopped');
  }

  // One path for every command, programmatic or live: validate through Core,
  // commit the returned state, allocate warning ids, forward the new state to
  // the renderer, and emit `state`. Commands while playing carry positions.
  private async runCommand(command: Command): Promise<CommandResult> {
    const state = this.requireCommandInput();
    const result = applyCommand(state, command, this.applyOptions());
    if (!result.ok) {
      throw new GasOperationError(result.failure.message, {
        kind: 'command',
        failure: result.failure
      });
    }
    return this.commit(result.state, result.warnings);
  }

  private async commit(
    state: InputState,
    coreWarnings: readonly CommandWarning[]
  ): Promise<CommandResult> {
    this.input = state;
    const warnings = coreWarnings.map((warning) => this.events.warn(warning));
    const playing = this.status === 'playing';
    const positions = await this.forwardState(state);
    this.emitState();
    return playing ? { warnings, ...positions } : { warnings };
  }

  private applyOptions(): ApplyCommandOptions {
    return { capabilities: this.renderer.getCapabilities() };
  }

  private async forwardState(state: InputState): Promise<AppliedPosition> {
    try {
      const result = await this.renderer.update(state);
      return {
        ...(result.requestedPosition !== undefined
          ? { requestedPosition: result.requestedPosition }
          : {}),
        ...(result.appliedPosition !== undefined ? { appliedPosition: result.appliedPosition } : {})
      };
    } catch (error) {
      // The Play ended while the change was on its way, or the connection
      // refused it, which ended the Play with one `error` event. Either way the
      // app value is kept (rule 5) and the event is the only report (rule 3).
      if (
        error instanceof RendererError &&
        (error.code === 'wrong-state' || error.code === 'connection-failed')
      ) {
        return {};
      }
      throw fromRendererError(error, 'The connection could not take the change.');
    }
  }

  private trackViews(): readonly TrackView[] {
    if (this.input === undefined) return [];
    const authored: TrackView[] = this.input.timeline.tracks.map((track) => ({
      id: track.trackId,
      name: track.name,
      description: track.description,
      source: 'document'
    }));
    const app: TrackView[] = this.input.appTracks.map((track) => ({
      id: track.id,
      ...(track.name !== undefined ? { name: track.name } : {}),
      ...(track.description !== undefined ? { description: track.description } : {}),
      source: 'app'
    }));
    return [...authored, ...app];
  }

  private appValueCommands(): readonly Command[] {
    if (this.input === undefined) return [];
    const defines: Command[] = this.input.appTracks.map((track) => ({
      kind: 'defineTrack',
      id: track.id,
      ...(track.name !== undefined ? { name: track.name } : {}),
      ...(track.description !== undefined ? { description: track.description } : {})
    }));
    return [...defines, ...this.input.appValues];
  }

  private snapshot(): SessionState {
    return {
      status: this.status,
      loaded: this.input !== undefined,
      ...(this.ended !== undefined ? { ended: this.ended } : {}),
      tracks: this.trackViews(),
      appValues: this.appValueCommands()
    };
  }

  private setStatus(status: SessionStatus): void {
    this.status = status;
    this.emitState();
  }

  private emitState(): void {
    this.events.emit('state', this.snapshot());
  }

  private requireInput(): InputState {
    this.ensureOpen();
    if (this.input === undefined) {
      throw new GasOperationError('No document is loaded.', { kind: 'state' });
    }
    return this.input;
  }

  // The state a command applies to. Commands reject while a document loads.
  private requireCommandInput(): InputState {
    const state = this.requireInput();
    if (this.loading) {
      throw new GasOperationError('Wait for the document to finish loading.', {
        kind: 'state'
      });
    }
    return state;
  }

  private requireStopped(action: string): void {
    this.ensureOpen();
    if (this.status !== 'stopped') {
      throw new GasOperationError(`Stop the session to ${action}.`, { kind: 'state' });
    }
  }

  private ensureOpen(): void {
    if (this.status === 'closed') {
      throw new GasOperationError('The session is closed.', { kind: 'state' });
    }
  }
}

// Play rejects when Stop or Close came before it resolved: the caller asked for
// playback and did not get it. Nothing is emitted.
function cancelled(cause?: unknown): GasOperationError {
  return new GasOperationError('Playback was stopped before it started.', {
    kind: 'cancelled',
    ...(cause !== undefined ? { cause } : {})
  });
}

function providerError(failure: RendererFailure): GasOperationError {
  return new GasOperationError(failure.message, {
    kind: 'provider',
    code: failure.code,
    reason: failure.reason,
    retryable: failure.retryable,
    ...(failure.closeCode !== undefined ? { closeCode: failure.closeCode } : {})
  });
}

// resolveTiming throws a RangeError for a bad tempo or time signature.
function fromDefaultsError(error: unknown, message: string): GasOperationError {
  if (error instanceof RangeError) {
    return new GasOperationError(message, { kind: 'command', cause: error });
  }
  return fromRendererError(error, message);
}

// Maps a renderer error to the session's kinds. A provider failure keeps only
// its safe classification, never provider text.
function fromRendererError(error: unknown, message: string): GasOperationError {
  if (!(error instanceof RendererError)) {
    return new GasOperationError(message, { kind: 'provider', reason: 'internal', cause: error });
  }
  if (error.failure !== undefined) return providerError(error.failure);
  switch (error.code) {
    case 'invalid-configuration':
      return new GasOperationError(message, { kind: 'command', cause: error.problems });
    case 'invalid-timeline':
      return new GasOperationError(message, { kind: 'document', cause: error.problems });
    default:
      return new GasOperationError(message, { kind: 'state', cause: error });
  }
}
