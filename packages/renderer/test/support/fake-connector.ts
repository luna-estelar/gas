import type {
  AudioSink,
  CapabilitiesTable,
  Connector,
  ConnectorAudioChunk,
  ConnectorConfig,
  ConnectorConfigValidation,
  ConnectorDescription,
  ConnectorSettings,
  ConnectorTiming,
  ConnectorUpdate,
  EffectiveState,
  MusicalPosition
} from '@luna-estelar/gas-protocol';

const ALL_SUPPORTED: CapabilitiesTable = {
  intents: {
    flavor: 'supported',
    key: 'supported',
    tempo: 'supported',
    time_signature: 'supported',
    timbre: 'supported',
    level: 'supported',
    notes: 'unsupported',
    motif: 'unsupported'
  }
};

/** Two seconds of silence, enough to anchor a run at the instant it is pushed. */
export function anchorChunk(runId: string): ConnectorAudioChunk {
  return {
    runId,
    bytes: new Uint8Array(4),
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: 48_000,
    channels: 2,
    durationSeconds: 2
  };
}

export interface FakeConnectorOptions {
  readonly describeFailure?: Error;
  readonly openFailure?: Error;
  readonly prepareFailure?: Error;
  readonly startFailure?: Error;
  readonly startChunks?: readonly ConnectorAudioChunk[];
  /**
   * Push one chunk from inside `start()`, tagged with the run id the renderer
   * actually allocated. The renderer anchors musical time on first audio, so a
   * test that wants a running renderer has to supply some.
   */
  readonly anchorOnStart?: boolean;
  readonly startGate?: Promise<void>;
  readonly updateFailure?: Error;
  readonly stopFailure?: Error;
  readonly closeFailure?: Error;
  readonly flowControlFailure?: Error;
  readonly appliedBoundary?: MusicalPosition;
  readonly description?: Partial<ConnectorDescription>;
  /**
   * Answer `validateConfig` with this. Omitted, the connector accepts everything,
   * matching its permissive advertised schema. Set to `null` to leave the optional
   * method off entirely and exercise the renderer's unvalidated fallback.
   */
  readonly validateConfig?: ((config: ConnectorConfig) => ConnectorConfigValidation) | null;
}

export class FakeConnector implements Connector {
  readonly calls: string[] = [];
  readonly openedSettings: ConnectorSettings[] = [];
  readonly prepared: Array<{ state: EffectiveState; config: ConnectorConfig }> = [];
  readonly updates: Array<{ update: ConnectorUpdate; requested: MusicalPosition }> = [];
  sink: AudioSink | undefined;
  timing: ConnectorTiming | undefined;
  runId: string | undefined;
  paused = false;

  private readonly description: ConnectorDescription;

  /** Present unless `validateConfig: null` asked for a connector without it. */
  readonly validateConfig?: (config: ConnectorConfig) => ConnectorConfigValidation;
  /** Kept out of `calls`, which several tests assert exactly. */
  readonly validated: ConnectorConfig[] = [];

  constructor(private readonly options: FakeConnectorOptions = {}) {
    if (options.validateConfig !== null) {
      const validate = options.validateConfig;
      this.validateConfig = (config) => {
        this.validated.push(config);
        return validate?.(config) ?? { ok: true };
      };
    }
    this.description = {
      id: 'fake',
      displayName: 'Fake connector',
      capabilities: ALL_SUPPORTED,
      model: {
        connectorId: 'fake',
        modelId: 'fake-v1',
        displayName: 'Fake model',
        codec: 'pcm',
        sampleFormat: 's16le',
        sampleRate: 48_000,
        channels: 2,
        chunkDurationSeconds: 2
      },
      configSchema: { type: 'object' },
      defaultConfig: {},
      supportsFlowControl: true,
      ...options.description
    };
  }

  async describe(): Promise<ConnectorDescription> {
    this.calls.push('describe');
    if (this.options.describeFailure !== undefined) throw this.options.describeFailure;
    return this.description;
  }

  async open(settings: ConnectorSettings): Promise<void> {
    this.calls.push('open');
    this.openedSettings.push(settings);
    if (this.options.openFailure !== undefined) throw this.options.openFailure;
  }

  async prepare(initialState: EffectiveState, config: ConnectorConfig): Promise<void> {
    this.calls.push('prepare');
    this.prepared.push({ state: initialState, config });
    if (this.options.prepareFailure !== undefined) throw this.options.prepareFailure;
  }

  async start(sink: AudioSink, timing: ConnectorTiming, runId: string): Promise<void> {
    this.calls.push('start');
    this.sink = sink;
    this.timing = timing;
    this.runId = runId;
    const startChunks =
      this.options.startChunks ?? (this.options.anchorOnStart === true ? [anchorChunk(runId)] : []);
    for (const chunk of startChunks) sink.push(chunk);
    if (this.options.startGate !== undefined) await this.options.startGate;
    if (this.options.startFailure !== undefined) throw this.options.startFailure;
  }

  async update(
    update: ConnectorUpdate,
    requestedBoundary: MusicalPosition
  ): Promise<MusicalPosition> {
    this.calls.push('update');
    this.updates.push({ update, requested: requestedBoundary });
    if (this.options.updateFailure !== undefined) throw this.options.updateFailure;
    return this.options.appliedBoundary ?? requestedBoundary;
  }

  async stop(runId: string): Promise<void> {
    this.calls.push(`stop:${runId}`);
    if (this.options.stopFailure !== undefined) throw this.options.stopFailure;
  }

  async close(): Promise<void> {
    this.calls.push('close');
    if (this.options.closeFailure !== undefined) throw this.options.closeFailure;
  }

  async setGenerationPaused(paused: boolean): Promise<void> {
    this.calls.push(`paused:${paused}`);
    this.paused = paused;
    if (this.options.flowControlFailure !== undefined) throw this.options.flowControlFailure;
  }
}
