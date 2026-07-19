import type {
  AudioSink,
  CapabilitiesTable,
  Connector,
  ConnectorConfig,
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

export interface FakeConnectorOptions {
  readonly openFailure?: Error;
  readonly startFailure?: Error;
  readonly stopFailure?: Error;
  readonly closeFailure?: Error;
  readonly description?: Partial<ConnectorDescription>;
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

  constructor(private readonly options: FakeConnectorOptions = {}) {
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
      supportsFlowControl: true,
      ...options.description
    };
  }

  async describe(): Promise<ConnectorDescription> {
    this.calls.push('describe');
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
  }

  async start(sink: AudioSink, timing: ConnectorTiming, runId: string): Promise<void> {
    this.calls.push('start');
    this.sink = sink;
    this.timing = timing;
    this.runId = runId;
    if (this.options.startFailure !== undefined) throw this.options.startFailure;
  }

  async update(
    update: ConnectorUpdate,
    requestedBoundary: MusicalPosition
  ): Promise<MusicalPosition> {
    this.calls.push('update');
    this.updates.push({ update, requested: requestedBoundary });
    return requestedBoundary;
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
  }
}
