import { validateTimeline } from '@luna-estelar/gas-core';
import type {
  CapabilitiesTable,
  Connector,
  ConnectorConfig,
  ConnectorConfigSchema,
  ConnectorDescription,
  ConnectorSettings,
  InputState,
  JsonObject,
  JsonValue,
  ModelInfo,
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
import { RendererError } from './errors.js';
import {
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
    throw new RendererError(
      'renderer-state-conflict',
      'Playback scheduling is not available until the next renderer slice.'
    );
  }

  async stop(): Promise<void> {
    if (this.lifecycle === 'closed') return;
    this.assertReady();
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
      playback: this.playback
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
