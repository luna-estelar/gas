// Controllable renderer fake that records calls and emits lifecycle events.
// The wiring factory creates a fresh instance for each session retry.

import type {
  AudioChunk,
  CapabilitiesTable,
  ConnectorConfig,
  ConnectorConfigSchema,
  IntentKeyword,
  IntentSupport,
  InputState,
  ModelInfo,
  MusicalPosition,
  Renderer,
  RendererDefaults,
  RendererEventMap,
  RendererFailure,
  RendererPositionEvent,
  RendererStatusEvent,
  RendererUpdateResult,
  RendererWarning,
  Timeline
} from '@luna-estelar/gas-protocol';
import type { SessionWiring } from '../../src/index.js';

const INTENT_KEYWORDS: readonly IntentKeyword[] = [
  'flavor',
  'key',
  'tempo',
  'time_signature',
  'timbre',
  'level',
  'notes',
  'motif'
];

export function capabilities(support: IntentSupport = 'supported'): CapabilitiesTable {
  return {
    intents: Object.fromEntries(INTENT_KEYWORDS.map((intent) => [intent, support])) as Record<
      IntentKeyword,
      IntentSupport
    >
  };
}

export function capabilitiesWith(
  patch: Partial<Record<IntentKeyword, IntentSupport>>
): CapabilitiesTable {
  return { intents: { ...capabilities().intents, ...patch } };
}

const MODEL_INFO: ModelInfo = {
  connectorId: 'fake',
  modelId: 'fake-1',
  displayName: 'Fake Model',
  chunkDurationSeconds: 2,
  codec: 'pcm',
  sampleFormat: 's16le',
  sampleRate: 48_000,
  channels: 2
};

export class FakeRenderer implements Renderer {
  readonly loads: Array<{ timeline: Timeline; inputState: InputState }> = [];
  readonly updates: InputState[] = [];
  starts = 0;
  stops = 0;
  closes = 0;

  failLoad = false;
  failStart = false;
  failStop = false;
  failUpdate = false;
  startError: unknown;
  startGate: Promise<void> | undefined;
  updateResult: RendererUpdateResult = {};

  private readonly caps: CapabilitiesTable;
  private defaults: RendererDefaults = { tempo: 120 };
  private connectorConfig: ConnectorConfig = { preset: 'default' };
  private readonly configSchema: ConnectorConfigSchema = { type: 'object' };
  private runCounter = 0;
  lastRunId: string | undefined;

  private readonly channels: {
    [K in keyof RendererEventMap]: Set<(payload: RendererEventMap[K]) => void>;
  } = {
    status: new Set(),
    position: new Set(),
    audio: new Set(),
    warning: new Set(),
    failure: new Set()
  };

  constructor(caps: CapabilitiesTable = capabilities()) {
    this.caps = caps;
  }

  async load(timeline: Timeline, inputState: InputState): Promise<void> {
    if (this.failLoad) throw new Error('fake load failure');
    this.loads.push({ timeline, inputState });
  }

  async updateState(inputState: InputState): Promise<RendererUpdateResult> {
    if (this.failUpdate) throw new Error('fake update failure');
    this.updates.push(inputState);
    return this.updateResult;
  }

  async start(): Promise<string> {
    if (this.failStart) throw new Error('fake start failure');
    this.starts += 1;
    this.runCounter += 1;
    this.lastRunId = `run-${this.runCounter}`;
    if (this.startGate !== undefined) await this.startGate;
    if (this.startError !== undefined) throw this.startError;
    return this.lastRunId;
  }

  async stop(): Promise<void> {
    this.stops += 1;
    if (this.failStop) throw new Error('fake stop failure');
  }

  async close(): Promise<void> {
    this.closes += 1;
  }

  on<K extends keyof RendererEventMap>(
    event: K,
    listener: (payload: RendererEventMap[K]) => void
  ): () => void {
    const channel = this.channels[event];
    channel.add(listener);
    return () => {
      channel.delete(listener);
    };
  }

  getCapabilities(): CapabilitiesTable {
    return this.caps;
  }
  getModelInfo(): ModelInfo {
    return MODEL_INFO;
  }
  getDefaults(): RendererDefaults {
    return this.defaults;
  }
  async updateDefaults(patch: Partial<RendererDefaults>): Promise<RendererDefaults> {
    this.defaults = { ...this.defaults, ...patch };
    return this.defaults;
  }
  getConnectorConfig(): ConnectorConfig {
    return this.connectorConfig;
  }
  async updateConnectorConfig(patch: ConnectorConfig): Promise<ConnectorConfig> {
    this.connectorConfig = { ...this.connectorConfig, ...patch };
    return this.connectorConfig;
  }
  getConfigSchema(): ConnectorConfigSchema {
    return this.configSchema;
  }

  // ---- test-side emitters -------------------------------------------------

  emitStatus(status: RendererStatusEvent): void {
    this.dispatch('status', status);
  }
  emitAudio(chunk: Partial<AudioChunk> & { runId: string }): void {
    this.dispatch('audio', { ...audioChunk(chunk.runId), ...chunk });
  }
  emitPosition(runId: string, position: MusicalPosition, seconds = 0, loopIteration = 0): void {
    const event: RendererPositionEvent = { runId, position, seconds, loopIteration };
    this.dispatch('position', event);
  }
  emitWarning(warning: RendererWarning): void {
    this.dispatch('warning', warning);
  }
  emitFailure(failure: RendererFailure): void {
    this.dispatch('failure', failure);
  }

  private dispatch<K extends keyof RendererEventMap>(event: K, payload: RendererEventMap[K]): void {
    for (const listener of [...this.channels[event]]) listener(payload);
  }
}

function audioChunk(runId: string): AudioChunk {
  return {
    runId,
    sequence: 0,
    bytes: new Uint8Array([0, 0]),
    durationSeconds: 2,
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: 48_000,
    channels: 2
  };
}

export interface FakeWiring extends SessionWiring {
  readonly renderers: FakeRenderer[];
  readonly current: () => FakeRenderer;
}

// Wiring that produces a fresh FakeRenderer per call. `configure` runs against
// each new renderer before it is handed over (e.g. to arm a failure), so retry
// can create a renderer that starts healthy.
export function createFakeWiring(
  configure?: (renderer: FakeRenderer) => void,
  caps?: CapabilitiesTable
): FakeWiring {
  const renderers: FakeRenderer[] = [];
  return {
    renderers,
    current: () => {
      const renderer = renderers[renderers.length - 1];
      if (renderer === undefined) throw new Error('no renderer created yet');
      return renderer;
    },
    async createRenderer(): Promise<Renderer> {
      const renderer = new FakeRenderer(caps);
      configure?.(renderer);
      renderers.push(renderer);
      return renderer;
    }
  };
}
