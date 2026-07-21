// Session lifecycle and command dispatch. Core owns state transitions;
// the wiring factory supplies the renderer.

import {
  applyCommand,
  applyCompletion,
  applyRetry,
  applyStop,
  createInputState,
  validateTimeline,
  warningsForTimeline,
  type CommandFailure,
  type InputState
} from '@luna-estelar/gas-core';
import { compileSource, parseLiveCommands } from '@luna-estelar/gas-language';
import type {
  CapabilitiesTable,
  Command,
  CompileResult,
  ConnectorConfig,
  ConnectorConfigSchema,
  LoadResult,
  ModelInfo,
  Renderer,
  RendererDefaults,
  RendererLifecycle,
  RendererStatusEvent,
  Timeline
} from '@luna-estelar/gas-protocol';

export type { CompileResult, LoadResult } from '@luna-estelar/gas-protocol';

import { liveStatementToCommand } from './commands.js';
import { EventHub, type SessionEvent, type SessionEventMap } from './events.js';
import { AcceptedRun } from './run.js';
import { resolveSource, type SourceInput } from './source.js';
import type { SessionWiring } from './wiring.js';
import {
  GasOperationError,
  type AppliedPosition,
  type CommandResult,
  type LiveCommandResult,
  type PlaybackPhase,
  type SessionState,
  type SessionWarning,
  type TrackView
} from './types.js';

export interface CompileOptions {
  readonly name?: string;
  readonly timelineId?: string;
}

// The Renderer config window (`session.renderer`). Reads pass straight through;
// edits are stopped-only, enforced here as well as in the Renderer.
export interface RendererControl {
  getCapabilities(): CapabilitiesTable;
  getModelInfo(): ModelInfo;
  getDefaults(): RendererDefaults;
  updateDefaults(patch: Partial<RendererDefaults>): Promise<RendererDefaults>;
  getConnectorConfig(): ConnectorConfig;
  updateConnectorConfig(patch: ConnectorConfig): Promise<ConnectorConfig>;
  getConfigSchema(): ConnectorConfigSchema;
}

export interface DefineTrackInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

export async function createSession(wiring: SessionWiring): Promise<GasSession> {
  const renderer = await wiring.createRenderer();
  return new GasSession(wiring, renderer);
}

export class GasSession {
  private readonly events = new EventHub();
  private readonly acceptedRun = new AcceptedRun();
  private rendererInstance: Renderer;
  private rendererUnsubs: Array<() => void> = [];
  private capabilities: CapabilitiesTable;
  private lifecycle: RendererLifecycle = 'ready';
  private phase: PlaybackPhase = 'stopped';
  private input: InputState | undefined;
  private closed = false;

  readonly renderer: RendererControl;

  constructor(
    private readonly wiring: SessionWiring,
    renderer: Renderer
  ) {
    this.rendererInstance = renderer;
    this.capabilities = renderer.getCapabilities();
    this.attachRenderer(renderer);
    this.renderer = this.buildRendererControl();
  }

  // ---- Source and loading -------------------------------------------------

  // Pure: compiles source to a timeline without touching session or Renderer
  // state. A compile error rejects with the diagnostics attached.
  async compileSource(input: SourceInput, options: CompileOptions = {}): Promise<CompileResult> {
    const { text, name } = await resolveSource(input);
    const sourceName = options.name ?? name;
    const result = compileSource(text, {
      ...(sourceName !== undefined ? { name: sourceName } : {}),
      ...(options.timelineId !== undefined ? { timelineId: options.timelineId } : {})
    });
    if (!result.ok) {
      throw new GasOperationError('The GAS source could not be compiled.', {
        kind: 'compile',
        diagnostics: result.diagnostics
      });
    }
    return { timeline: result.timeline, diagnostics: result.diagnostics };
  }

  // Compile then commit the timeline while stopped. Atomic: nothing is mutated
  // until the Renderer accepts the load, so a failed load leaves the previous
  // document and playback untouched.
  async loadSource(input: SourceInput, options: CompileOptions = {}): Promise<LoadResult> {
    const compiled = await this.compileSource(input, options);
    const result = await this.commitTimeline(compiled.timeline, 'load');
    if (compiled.diagnostics.length > 0) {
      this.events.emit('diagnostic', { source: 'compile', diagnostics: compiled.diagnostics });
    }
    return result;
  }

  // Commit a canonical protocol 1.0 timeline. Core validates it before any
  // Renderer call; an invalid timeline rejects and leaves the session unchanged.
  async loadTimeline(timeline: Timeline, _options: CompileOptions = {}): Promise<LoadResult> {
    const validation = validateTimeline(timeline);
    if (!validation.ok) {
      throw new GasOperationError('The timeline is not valid.', {
        kind: 'validate',
        diagnostics: [],
        cause: validation.problems
      });
    }
    return this.commitTimeline(timeline, 'load');
  }

  private async commitTimeline(timeline: Timeline, reason: 'load' | 'retry'): Promise<LoadResult> {
    this.ensureOpen();
    if (reason === 'load' && this.phase !== 'stopped') {
      throw new GasOperationError('Stop the session before loading a new document.', {
        kind: 'lifecycle'
      });
    }
    const next = createInputState(timeline);
    // Load the Renderer first; only commit once it accepts, so a failure is
    // atomic with respect to the previously loaded document.
    try {
      await this.rendererInstance.load(timeline, next);
    } catch (error) {
      throw new GasOperationError('The Renderer failed to load the timeline.', {
        kind: 'renderer',
        cause: error
      });
    }
    this.input = next;
    this.acceptedRun.clear();
    this.phase = 'stopped';
    this.emitState();
    const warnings = warningsForTimeline(timeline, this.capabilities).map((warning) =>
      this.events.warn(warning)
    );
    return { warnings };
  }

  // ---- Programmatic commands ----------------------------------------------

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

  // ---- Live commands ------------------------------------------------------

  // Parse the whole submission first (a structural error rejects everything),
  // then apply statements sequentially through the same Core path. Earlier
  // successes stay committed; a later failure resolves with a failure payload
  // (partial success). A failure before anything commits rejects.
  async submitLiveCommands(input: SourceInput): Promise<LiveCommandResult> {
    this.ensureOpen();
    let state = this.requireInput();
    const { text } = await resolveSource(input);
    const parsed = parseLiveCommands(text);
    if (!parsed.ok) {
      throw new GasOperationError('The live commands could not be parsed.', {
        kind: 'live',
        diagnostics: parsed.diagnostics
      });
    }

    const options = this.applyOptions();
    const warnings: SessionWarning[] = [];
    let applied = 0;
    let failure: CommandFailure | undefined;

    for (const statement of parsed.statements) {
      const command = liveStatementToCommand(statement, state);
      const result = applyCommand(state, command, options);
      if (!result.ok) {
        failure = result.failure;
        break;
      }
      state = result.state;
      for (const warning of result.warnings) warnings.push(this.events.warn(warning));
      applied += 1;
    }

    // Nothing committed → a plain failed operation → reject.
    if (failure !== undefined && applied === 0) {
      throw new GasOperationError(failure.message, { kind: 'live', failure, warnings });
    }

    this.input = state;
    const positions = applied > 0 ? await this.forwardState() : {};
    this.emitState();

    if (failure !== undefined) {
      return { ok: false, applied, warnings, failure };
    }
    return { ok: true, applied, warnings, ...(this.phase === 'active' ? positions : {}) };
  }

  // ---- Playback -----------------------------------------------------------

  async play(): Promise<void> {
    this.ensureOpen();
    if (this.input === undefined) {
      throw new GasOperationError('Load a timeline before playing.', { kind: 'playback' });
    }
    if (this.phase === 'active') {
      throw new GasOperationError('The session is already playing.', { kind: 'playback' });
    }
    if (this.lifecycle !== 'ready') {
      throw new GasOperationError('The Renderer is not ready; retry it first.', {
        kind: 'playback'
      });
    }
    let runId: string;
    try {
      runId = await this.rendererInstance.start();
    } catch (error) {
      this.markRendererFailed();
      const failure = new GasOperationError('The Renderer failed to start.', {
        kind: 'playback',
        cause: error
      });
      this.events.emit('error', failure);
      this.emitState();
      throw failure;
    }
    this.acceptedRun.accept(runId);
    this.phase = 'active';
    this.emitState();
  }

  // Safe at any time, including when already stopped. Clears the accepted run so
  // in-flight audio is rejected, applies Core's stop transition, and lands
  // stopped even if the Renderer stop fails.
  async stop(): Promise<void> {
    this.ensureOpen();
    this.acceptedRun.clear();
    if (this.lifecycle === 'ready') {
      try {
        await this.rendererInstance.stop();
      } catch {
        this.markRendererFailed();
      }
    }
    if (this.input !== undefined) {
      this.input = applyStop(this.input);
      if (this.lifecycle === 'ready') {
        try {
          await this.rendererInstance.updateState(this.input);
        } catch {
          this.markRendererFailed();
        }
      }
    }
    this.phase = 'stopped';
    this.emitState();
  }

  // Close the failed Renderer, apply Core's retry transition (overrides cleared,
  // host tracks preserved), build a fresh Renderer from the factory, reload from
  // bar 1, and remain stopped.
  async retryRenderer(): Promise<void> {
    this.ensureOpen();
    this.detachRenderer();
    try {
      await this.rendererInstance.close();
    } catch {
      // A failed Renderer may reject on close; the point is to discard it.
    }
    this.acceptedRun.clear();
    this.phase = 'stopped';
    if (this.input !== undefined) {
      this.input = applyRetry(this.input);
    }

    let renderer: Renderer;
    try {
      renderer = await this.wiring.createRenderer();
    } catch (error) {
      this.lifecycle = 'failed';
      const failure = new GasOperationError('Building a fresh Renderer failed.', {
        kind: 'renderer',
        cause: error
      });
      this.events.emit('error', failure);
      this.emitState();
      throw failure;
    }

    if (this.input !== undefined) {
      try {
        await renderer.load(this.input.timeline, this.input);
      } catch (error) {
        try {
          await renderer.close();
        } catch {
          // The rejected candidate is discarded regardless of close outcome.
        }
        this.lifecycle = 'failed';
        const failure = new GasOperationError('The fresh Renderer failed to reload the timeline.', {
          kind: 'renderer',
          cause: error
        });
        this.events.emit('error', failure);
        this.emitState();
        throw failure;
      }
    }
    this.rendererInstance = renderer;
    this.attachRenderer(renderer);
    this.capabilities = renderer.getCapabilities();
    this.lifecycle = 'ready';
    this.emitState();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.detachRenderer();
    this.acceptedRun.clear();
    this.phase = 'stopped';
    try {
      await this.rendererInstance.close();
    } catch {
      // Best effort; the session is closing regardless.
    }
    this.lifecycle = 'closed';
    this.emitState();
    this.events.clear();
  }

  // ---- Events -------------------------------------------------------------

  on<K extends SessionEvent>(
    event: K,
    listener: (payload: SessionEventMap[K]) => void
  ): () => void {
    return this.events.on(event, listener);
  }

  // ---- Internals ----------------------------------------------------------

  // One path for every command — programmatic or live: validate through Core,
  // commit the returned state, allocate warning ids, forward the new state to
  // the Renderer, and emit `state`. Active commands carry the Renderer's
  // positions; stopped commands carry none.
  private async runCommand(command: Command): Promise<CommandResult> {
    const state = this.requireInput();
    const result = applyCommand(state, command, this.applyOptions());
    if (!result.ok) {
      throw new GasOperationError(result.failure.message, {
        kind: 'command',
        failure: result.failure
      });
    }
    this.input = result.state;
    const warnings = result.warnings.map((warning) => this.events.warn(warning));
    const positions = await this.forwardState();
    this.emitState();
    return this.phase === 'active' ? { warnings, ...positions } : { warnings };
  }

  private applyOptions(): {
    readonly phase: PlaybackPhase;
    readonly capabilities: CapabilitiesTable;
  } {
    return { phase: this.phase, capabilities: this.capabilities };
  }

  // Forward the current input to the Renderer after an accepted command. While
  // active the returned positions ride back on the command result; while stopped
  // they are dropped (a stopped command carries no position).
  private async forwardState(): Promise<AppliedPosition> {
    if (this.input === undefined) return {};
    try {
      const result = await this.rendererInstance.updateState(this.input);
      return {
        ...(result.requestedPosition !== undefined
          ? { requestedPosition: result.requestedPosition }
          : {}),
        ...(result.appliedPosition !== undefined ? { appliedPosition: result.appliedPosition } : {})
      };
    } catch (error) {
      this.markRendererFailed();
      const failure = new GasOperationError('The Renderer failed to accept the command.', {
        kind: 'renderer',
        cause: error
      });
      this.events.emit('error', failure);
      throw failure;
    }
  }

  private trackViews(): readonly TrackView[] {
    if (this.input === undefined) return [];
    const authored: TrackView[] = this.input.timeline.tracks.map((track) => ({
      id: track.trackId,
      name: track.name,
      description: track.description,
      source: 'authored'
    }));
    const host: TrackView[] = this.input.hostTracks.map((track) => ({
      id: track.id,
      ...(track.name !== undefined ? { name: track.name } : {}),
      ...(track.description !== undefined ? { description: track.description } : {}),
      source: 'host'
    }));
    return [...authored, ...host];
  }

  private snapshot(): SessionState {
    return {
      lifecycle: this.lifecycle,
      playback: this.phase,
      timelineLoaded: this.input !== undefined,
      ...(this.acceptedRun.id !== undefined ? { runId: this.acceptedRun.id } : {}),
      tracks: this.trackViews()
    };
  }

  private emitState(): void {
    this.events.emit('state', this.snapshot());
  }

  private requireInput(): InputState {
    this.ensureOpen();
    if (this.input === undefined) {
      throw new GasOperationError('No timeline is loaded.', { kind: 'command' });
    }
    return this.input;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new GasOperationError('The session is closed.', { kind: 'lifecycle' });
    }
  }

  private markRendererFailed(): void {
    this.lifecycle = 'failed';
    this.acceptedRun.clear();
    this.phase = 'stopped';
  }

  private buildRendererControl(): RendererControl {
    return {
      getCapabilities: () => this.capabilities,
      getModelInfo: () => this.rendererInstance.getModelInfo(),
      getDefaults: () => this.rendererInstance.getDefaults(),
      // Async so the stopped-only guard rejects the returned promise rather than
      // throwing synchronously.
      updateDefaults: async (patch) => {
        this.requireStoppedForConfig();
        return this.rendererInstance.updateDefaults(patch);
      },
      getConnectorConfig: () => this.rendererInstance.getConnectorConfig(),
      updateConnectorConfig: async (patch) => {
        this.requireStoppedForConfig();
        return this.rendererInstance.updateConnectorConfig(patch);
      },
      getConfigSchema: () => this.rendererInstance.getConfigSchema()
    };
  }

  private requireStoppedForConfig(): void {
    this.ensureOpen();
    if (this.phase !== 'stopped') {
      throw new GasOperationError('Renderer config edits are only allowed while stopped.', {
        kind: 'lifecycle'
      });
    }
  }

  private attachRenderer(renderer: Renderer): void {
    this.rendererUnsubs = [
      renderer.on('status', (status) => this.onRendererStatus(status)),
      renderer.on('position', (position) => {
        if (this.acceptedRun.accepts(position.runId)) this.events.emit('position', position);
      }),
      renderer.on('audio', (chunk) => {
        if (this.acceptedRun.accepts(chunk.runId)) this.events.emit('audio', chunk);
      }),
      renderer.on('warning', (warning) => {
        this.events.warnRenderer(warning);
      }),
      renderer.on('failure', (failure) => {
        this.markRendererFailed();
        this.events.emit(
          'error',
          new GasOperationError(failure.message, {
            kind: 'renderer',
            ...(failure.reason !== undefined ? { reason: failure.reason } : {})
          })
        );
        this.emitState();
      })
    ];
  }

  private detachRenderer(): void {
    for (const unsubscribe of this.rendererUnsubs) unsubscribe();
    this.rendererUnsubs = [];
  }

  private onRendererStatus(status: RendererStatusEvent): void {
    this.lifecycle = status.lifecycle;
    // Apply completion before emitting lifecycle events so phase and state agree.
    const endedThisRun =
      status.stream === 'ended' &&
      (status.runId === undefined || this.acceptedRun.accepts(status.runId));
    if (this.phase === 'active' && endedThisRun) {
      this.acceptedRun.clear();
      if (this.input !== undefined) this.input = applyCompletion(this.input);
      this.phase = 'stopped';
      this.emitState();
    }
    this.events.emit('lifecycle', {
      lifecycle: status.lifecycle,
      playback: this.phase,
      ...(status.runId !== undefined ? { runId: status.runId } : {})
    });
  }
}
