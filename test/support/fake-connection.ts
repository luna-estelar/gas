// A scriptable Connector and Connection, shared by the renderer, session,
// browser and root tests. Protocol-only, like the other shared fixtures.
import type {
  CapabilitiesTable,
  ConnectOptions,
  Connection,
  ConnectorAudioChunk,
  Connector,
  ConnectorConfig,
  ConnectorConfigValidation,
  ConnectorDescription,
  ConnectorError,
  ConnectorUpdate,
  ConnectorWarning,
  MusicalPosition
} from '../../packages/gas/src/protocol/index.js';
import { deferred, type Deferred } from './deferred.js';

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

export const FAKE_SAMPLE_RATE = 48_000;
export const FAKE_CHANNELS = 2;

export function fakeDescription(
  overrides: Partial<ConnectorDescription> = {}
): ConnectorDescription {
  return {
    id: 'fake',
    displayName: 'Fake connector',
    capabilities: ALL_SUPPORTED,
    model: {
      connectorId: 'fake',
      modelId: 'fake-v1',
      displayName: 'Fake model',
      codec: 'pcm',
      sampleFormat: 's16le',
      sampleRate: FAKE_SAMPLE_RATE,
      channels: FAKE_CHANNELS,
      chunkDurationSeconds: 2
    },
    configSchema: { type: 'object' },
    defaultConfig: {},
    ...overrides
  };
}

export type ConnectionCall = 'update' | 'pause' | 'resume' | 'close';

export class FakeConnection implements Connection {
  readonly calls: ConnectionCall[] = [];
  /** `pause` and `resume` only, in order. */
  readonly flow: Array<'pause' | 'resume'> = [];
  readonly updates: Array<{ update: ConnectorUpdate; requested: MusicalPosition }> = [];
  /** Every call made after `close()`, which should stay empty. */
  readonly lateCalls: ConnectionCall[] = [];
  /** What `update()` resolves with. Unset, it echoes the requested position. */
  appliedPosition: MusicalPosition | undefined;
  /** Holds `close()` open until it settles. Set `closeHangs` on the connector for every connection. */
  closeGate: Promise<void> | undefined;
  closed = false;

  constructor(
    readonly options: ConnectOptions,
    private readonly chunkSeconds: number
  ) {}

  async update(update: ConnectorUpdate, requested: MusicalPosition): Promise<MusicalPosition> {
    this.record('update');
    this.updates.push({ update, requested });
    return this.appliedPosition ?? requested;
  }

  async pause(): Promise<void> {
    this.record('pause');
    this.flow.push('pause');
  }

  async resume(): Promise<void> {
    this.record('resume');
    this.flow.push('resume');
  }

  async close(): Promise<void> {
    this.record('close');
    this.closed = true;
    if (this.closeGate !== undefined) await this.closeGate;
  }

  /**
   * Sends `seconds` of s16le audio in the model's format, in chunks of the
   * model's `chunkDurationSeconds` with a shorter last one, as a provider does.
   * One big chunk would go out at once and never count as held. Every sample is
   * `sample`, so a test can tell the connection's audio from GAS silence (0).
   */
  pushAudio(seconds: number, sample = 1000): void {
    let left = seconds;
    while (left > 1e-9) {
      const duration = Math.min(this.chunkSeconds, left);
      this.options.onAudio(s16leChunk(duration, sample));
      left -= duration;
    }
  }

  fail(error: ConnectorError): void {
    this.options.onError(error);
  }

  warn(warning: ConnectorWarning): void {
    this.options.onWarning(warning);
  }

  private record(call: ConnectionCall): void {
    if (this.closed) this.lateCalls.push(call);
    this.calls.push(call);
  }
}

export interface FakeConnectorOptions {
  readonly description?: Partial<ConnectorDescription>;
  /** Omitted, every config is accepted. `null` leaves the optional method off. */
  readonly validateConfig?: ((config: ConnectorConfig) => ConnectorConfigValidation) | null;
  /** Every connection's `close()` never settles. */
  readonly closeHangs?: boolean;
}

interface PendingConnect {
  readonly options: ConnectOptions;
  readonly settle: Deferred<Connection>;
}

export class FakeConnector implements Connector {
  readonly description: ConnectorDescription;
  readonly validateConfig?: (config: ConnectorConfig) => ConnectorConfigValidation;
  /** The options of every `connect()` call, in order. */
  readonly connects: ConnectOptions[] = [];
  /** Every connection handed out, including late ones GAS should close. */
  readonly connections: FakeConnection[] = [];
  /** Resolve `connect()` at once. Turn off to land Stop or Close mid-connect. */
  autoConnect = true;
  /**
   * Off (the default), an aborted `connect()` rejects straight away. On, it
   * ignores the signal and waits for `resolveConnect()` or `rejectConnect()`,
   * like a provider call that hangs.
   */
  ignoreAbort = false;

  private pending: PendingConnect | undefined;

  constructor(private readonly fakeOptions: FakeConnectorOptions = {}) {
    this.description = fakeDescription(fakeOptions.description);
    if (fakeOptions.validateConfig !== null) {
      const validate = fakeOptions.validateConfig;
      this.validateConfig = (config) => validate?.(config) ?? { ok: true };
    }
  }

  connect(options: ConnectOptions): Promise<Connection> {
    this.connects.push(options);
    if (this.autoConnect) return Promise.resolve(this.open(options));
    const settle = deferred<Connection>();
    const pending: PendingConnect = { options, settle };
    this.pending = pending;
    options.signal.addEventListener('abort', () => {
      if (this.ignoreAbort || this.pending !== pending) return;
      this.pending = undefined;
      settle.reject(abortError());
    });
    return settle.promise;
  }

  /** Resolves the pending `connect()` with a new connection, even after abort. */
  resolveConnect(): FakeConnection {
    const pending = this.takePending();
    const connection = this.open(pending.options);
    pending.settle.resolve(connection);
    return connection;
  }

  rejectConnect(error: unknown): void {
    this.takePending().settle.reject(error);
  }

  get connectPending(): boolean {
    return this.pending !== undefined;
  }

  latest(): FakeConnection {
    const connection = this.connections.at(-1);
    if (connection === undefined) throw new Error('No connection has opened.');
    return connection;
  }

  private open(options: ConnectOptions): FakeConnection {
    const connection = new FakeConnection(options, this.description.model.chunkDurationSeconds);
    if (this.fakeOptions.closeHangs === true) connection.closeGate = new Promise(() => undefined);
    this.connections.push(connection);
    return connection;
  }

  private takePending(): PendingConnect {
    const pending = this.pending;
    if (pending === undefined) throw new Error('No connect() is pending.');
    this.pending = undefined;
    return pending;
  }
}

function s16leChunk(seconds: number, sample: number): ConnectorAudioChunk {
  const frames = Math.round(seconds * FAKE_SAMPLE_RATE);
  const bytes = new Uint8Array(frames * FAKE_CHANNELS * 2);
  const view = new DataView(bytes.buffer);
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    view.setInt16(offset, sample, true);
  }
  return {
    bytes,
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: FAKE_SAMPLE_RATE,
    channels: FAKE_CHANNELS,
    durationSeconds: seconds
  };
}

function abortError(): Error {
  const error = new Error('The connect was aborted.');
  error.name = 'AbortError';
  return error;
}
