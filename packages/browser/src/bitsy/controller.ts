// Apply score actions to a running session. score.ts maps game state to actions;
// this controller handles dispatch, tracing and playback lifecycle.
import { GasOperationError, type GasSession } from '@luna-estelar/gas-api';
import { emptyGameSnapshot, snapshotFrom } from './bridge.js';
import { reactToGameEvent, rehydrationActions, roomBeat, type MusicalAction } from './score.js';
import type { BrowserSession } from '../wiring.js';
import type { BeatId, BitsyBridgeMessage, DemoState, TraceEntry, TraceStatus } from './types.js';

export interface SnippetVersion {
  readonly source: string;
  readonly lastValidSource: string;
  readonly valid: boolean;
}

// Still BYOK-shaped, from when that was the only access mode. createBrowserSession
// now takes an Access, so a surface wiring this up can widen the parameter.
export type RuntimeFactory = (apiKey: string) => Promise<BrowserSession>;
export type SnippetProvider = (id: BeatId) => SnippetVersion;
type StateListener = (state: DemoState) => void;

// Preserve the controller entrypoint for consumers of the score rules.
export { asteroidLevels } from './score.js';

const TRACE_LIMIT = 80;

function operationDetail(value: unknown): { status: TraceStatus; detail?: string } {
  if (value === undefined) return { status: 'applied' };
  if (value === null || typeof value !== 'object') return { status: 'applied' };
  const result = value as {
    readonly ok?: boolean;
    readonly applied?: number;
    readonly warnings?: readonly unknown[];
    readonly failure?: { readonly message?: string };
    readonly requestedPosition?: { readonly bar?: number };
    readonly appliedPosition?: { readonly bar?: number };
  };
  const parts: string[] = [];
  if (result.appliedPosition?.bar !== undefined) {
    parts.push(`audible at bar ${result.appliedPosition.bar}`);
  } else if (result.requestedPosition?.bar !== undefined) {
    parts.push(`requested for bar ${result.requestedPosition.bar}`);
  }
  if (result.applied !== undefined) parts.push(`${result.applied} statements applied`);
  if ((result.warnings?.length ?? 0) > 0) parts.push(`${result.warnings?.length} warning(s)`);
  if (result.ok === false) {
    parts.push(result.failure?.message ?? 'A later statement failed.');
    return { status: 'error', detail: parts.join(' · ') };
  }
  return {
    status: (result.warnings?.length ?? 0) > 0 ? 'warning' : 'applied',
    ...(parts.length > 0 ? { detail: parts.join(' · ') } : {})
  };
}

function errorState(error: unknown): { reason?: string; message: string } {
  if (error instanceof GasOperationError) {
    return {
      ...(error.reason !== undefined ? { reason: error.reason } : {}),
      message: error.message
    };
  }
  return { message: error instanceof Error ? error.message : 'The audio session failed.' };
}

export class BitsyDemoController {
  private state: DemoState = {
    status: 'silent',
    retryAvailable: false,
    snapshot: emptyGameSnapshot(),
    selectedBeat: 'room-andromeda',
    traces: []
  };
  private runtime: BrowserSession | undefined;
  private readonly listeners = new Set<StateListener>();
  private sessionUnsubs: Array<() => void> = [];
  private chain: Promise<void> = Promise.resolve();
  private traceSequence = 0;
  private closed = false;

  constructor(
    private readonly baselineSource: string,
    private readonly createRuntime: RuntimeFactory,
    private readonly getSnippet: SnippetProvider
  ) {}

  getState(): DemoState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  selectBeat(id: BeatId): void {
    this.patch({ selectedBeat: id });
  }

  async enableSound(apiKey: string): Promise<void> {
    if (this.closed) throw new Error('The Bitsy demo is closed.');
    if (this.runtime !== undefined && this.state.status !== 'failed') return;
    if (this.runtime !== undefined) await this.disposeRuntime();
    const trimmed = apiKey.trim();
    if (trimmed === '') throw new Error('Enter a Gemini API key to enable sound.');
    this.patch({ status: 'connecting', error: undefined, retryAvailable: false });
    let loaded = false;
    try {
      const runtime = await this.createRuntime(trimmed);
      this.runtime = runtime;
      this.attachSession(runtime.session);
      await this.trace('sound enabled', 'session.loadSource("way-back-home.gas")', () =>
        runtime.session.loadSource(this.baselineSource, { name: 'way-back-home.gas' })
      );
      loaded = true;
      runtime.playback.restoreGain();
      await this.trace('sound enabled', 'session.play()', () => runtime.session.play());
      this.patch({ status: 'active', error: undefined, retryAvailable: false });
      await this.enqueue(() => this.rehydrate('current game state'));
    } catch (error) {
      if (this.runtime !== undefined) {
        this.runtime.playback.flush();
        await this.runtime.session.stop().catch(() => undefined);
        if (!loaded) await this.disposeRuntime();
      }
      this.fail(error, loaded && this.runtime !== undefined);
      throw error;
    }
  }

  handleGameEvent(message: BitsyBridgeMessage): Promise<void> {
    const previous = this.state.snapshot;
    const snapshot = snapshotFrom(message);
    const reaction = reactToGameEvent(message, previous);
    this.patch({
      snapshot,
      ...(reaction.selectBeat !== undefined ? { selectedBeat: reaction.selectBeat } : {})
    });
    if (this.runtime === undefined || this.state.status === 'connecting') return Promise.resolve();

    return this.enqueue(async () => {
      if (reaction.reset) {
        // A reload of the game, not a new one: only restart a score that was
        // actually running, or the first `game-ready` would stop a session that
        // enableSound had just started.
        if (this.state.status === 'active' || this.state.status === 'stopped') {
          await this.resetPlaythrough();
        }
        return;
      }
      await this.applyAll(reaction.actions);
    });
  }

  applySnippet(id: BeatId, source: string): Promise<void> {
    this.patch({ selectedBeat: id });
    return this.enqueue(() =>
      this.trace(`manual edit: ${id}`, `session.submitLiveCommands("${id}.gas")`, () =>
        this.requireSession().submitLiveCommands(source)
      )
    );
  }

  retry(): Promise<void> {
    return this.enqueue(async () => {
      const runtime = this.requireRuntime();
      this.patch({ status: 'connecting', error: undefined, retryAvailable: false });
      runtime.playback.flush();
      await this.trace('retry', 'session.retryRenderer()', () => runtime.session.retryRenderer());
      runtime.playback.restoreGain();
      await this.trace('retry', 'session.play()', () => runtime.session.play());
      this.patch({ status: 'active', error: undefined, retryAvailable: false });
      await this.rehydrate('retry state restore');
    }).catch((error: unknown) => {
      this.fail(error, this.runtime !== undefined);
      throw error;
    });
  }

  stop(): Promise<void> {
    return this.enqueue(async () => {
      const runtime = this.requireRuntime();
      await this.trace('user stop', 'session.stop()', () => runtime.session.stop());
      runtime.playback.flush();
      this.patch({ status: 'stopped', runId: undefined, retryAvailable: false });
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.chain.catch(() => undefined);
    await this.disposeRuntime();
    this.listeners.clear();
  }

  private async applyAll(actions: readonly MusicalAction[]): Promise<void> {
    // Sequential, not Promise.all: these are ordered musical instructions. Galle
    // Beach's tempo has to land before the beat that is heard at it.
    for (const action of actions) await this.apply(action);
  }

  private async apply(action: MusicalAction): Promise<void> {
    switch (action.kind) {
      case 'beat':
        this.patch({ selectedBeat: action.beat });
        await this.submitBeat(action.beat, action.event);
        return;
      case 'tempo':
        await this.command(action.event, `session.setTempo(${action.bpm})`, (session) =>
          session.setTempo(action.bpm)
        );
        return;
      case 'global-level':
        await this.command(action.event, `session.setGlobalLevel(${action.value})`, (session) =>
          session.setGlobalLevel(action.value)
        );
        return;
      case 'track-level': {
        const id = this.trackId(action.track);
        await this.command(
          action.event,
          `session.setTrackLevel("${id}", ${action.value})`,
          (session) => session.setTrackLevel(id, action.value)
        );
        return;
      }
      case 'play-track': {
        const id = this.trackId(action.track);
        await this.command(action.event, `session.playTrack("${id}")`, (session) =>
          session.playTrack(id)
        );
        return;
      }
      case 'stop-track': {
        const id = this.trackId(action.track);
        await this.command(action.event, `session.stopTrack("${id}")`, (session) =>
          session.stopTrack(id)
        );
        return;
      }
      case 'ending':
        // The one action that is not a session command: a master fade in Web
        // Audio, then a stop. It needs the runtime, so it cannot live in score.js.
        await this.finishEnding();
        return;
    }
  }

  private async rehydrate(event: string): Promise<void> {
    const snapshot = this.state.snapshot;
    this.patch({ selectedBeat: roomBeat(snapshot.room.name) ?? 'room-andromeda' });
    await this.applyAll(rehydrationActions(snapshot, event));
  }

  private async resetPlaythrough(): Promise<void> {
    const runtime = this.requireRuntime();
    await this.trace('game reset', 'session.stop()', () => runtime.session.stop());
    runtime.playback.flush();
    runtime.playback.restoreGain();
    await this.trace('game reset', 'session.play()', () => runtime.session.play());
    this.patch({ status: 'active', error: undefined, retryAvailable: false });
    await this.rehydrate('game reset state');
  }

  private async submitBeat(id: BeatId, event: string): Promise<void> {
    const version = this.getSnippet(id);
    const source = version.valid ? version.source : version.lastValidSource;
    if (!version.valid) {
      this.addTrace({
        event,
        operation: `${id}.gas draft`,
        status: 'skipped',
        detail: 'Invalid draft skipped; applying the last valid version.'
      });
    }
    await this.trace(event, `session.submitLiveCommands("${id}.gas")`, () =>
      this.requireSession().submitLiveCommands(source)
    );
  }

  private async finishEnding(): Promise<void> {
    const runtime = this.requireRuntime();
    await this.trace('beach mat ending', 'Web Audio master fade (1.2s)', () =>
      runtime.playback.fadeOut(1.2)
    );
    await this.trace('beach mat ending', 'session.stop()', () => runtime.session.stop());
    runtime.playback.flush();
    this.patch({ status: 'stopped', runId: undefined, retryAvailable: false });
  }

  private command(
    event: string,
    operation: string,
    action: (session: GasSession) => Promise<unknown>
  ): Promise<void> {
    return this.trace(event, operation, () => action(this.requireSession()));
  }

  private trackId(name: string): string {
    const tracks = this.requireSession().getTracks();
    return (
      tracks.find((track) => track.name?.toLowerCase() === name.toLowerCase())?.id ??
      `track.${name}`
    );
  }

  private attachSession(session: GasSession): void {
    this.sessionUnsubs = [
      session.on('state', (state) => {
        this.patch({
          ...(state.runId !== undefined ? { runId: state.runId } : { runId: undefined }),
          status:
            state.lifecycle === 'failed'
              ? 'failed'
              : state.playback === 'active'
                ? 'active'
                : this.state.status
        });
      }),
      session.on('warning', (warning) => {
        this.addTrace({
          event: 'session warning',
          operation: warning.code,
          status: 'warning',
          detail: warning.message
        });
      }),
      session.on('diagnostic', (diagnostic) => {
        const first = diagnostic.diagnostics[0];
        this.addTrace({
          event: 'GAS diagnostic',
          operation: diagnostic.source,
          status: diagnostic.diagnostics.some((item) => item.severity === 'error')
            ? 'error'
            : 'warning',
          ...(first !== undefined ? { detail: first.message } : {})
        });
      }),
      session.on('error', (error) => {
        this.runtime?.playback.flush();
        void session.stop().catch(() => undefined);
        this.fail(error, this.runtime !== undefined);
      })
    ];
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async trace(
    event: string,
    operation: string,
    action: () => Promise<unknown>
  ): Promise<void> {
    const id = this.addTrace({ event, operation, status: 'pending' });
    try {
      const value = await action();
      this.updateTrace(id, operationDetail(value));
    } catch (error) {
      const failure = errorState(error);
      this.updateTrace(id, { status: 'error', detail: failure.message });
      throw error;
    }
  }

  private addTrace(entry: Omit<TraceEntry, 'id' | 'createdAt'>): number {
    const id = ++this.traceSequence;
    const trace: TraceEntry = { id, createdAt: Date.now(), ...entry };
    this.patch({ traces: [trace, ...this.state.traces].slice(0, TRACE_LIMIT) });
    return id;
  }

  private updateTrace(id: number, update: Pick<TraceEntry, 'status' | 'detail'>): void {
    this.patch({
      traces: this.state.traces.map((trace) =>
        trace.id === id
          ? {
              ...trace,
              status: update.status,
              ...(update.detail !== undefined ? { detail: update.detail } : {})
            }
          : trace
      )
    });
  }

  private fail(error: unknown, retryAvailable = false): void {
    const failure = errorState(error);
    this.patch({ status: 'failed', error: failure, runId: undefined, retryAvailable });
  }

  private requireRuntime(): BrowserSession {
    if (this.runtime === undefined) throw new Error('Enable sound before controlling the score.');
    return this.runtime;
  }

  private requireSession(): GasSession {
    return this.requireRuntime().session;
  }

  private async disposeRuntime(): Promise<void> {
    for (const unsubscribe of this.sessionUnsubs) unsubscribe();
    this.sessionUnsubs = [];
    const runtime = this.runtime;
    this.runtime = undefined;
    if (runtime !== undefined) await runtime.close();
  }

  private patch(patch: Partial<DemoState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}
