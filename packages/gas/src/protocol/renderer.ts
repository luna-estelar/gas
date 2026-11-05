// The renderer's own types and the pre-0.4 connector interface. Step 4 of 0.4
// makes the renderer internal and removes this file.

import type { CapabilitiesTable } from './capabilities.js';
import type {
  AudioFormat,
  ConnectorConfig,
  ConnectorConfigSchema,
  ConnectorConfigValidation,
  ConnectorDescription,
  ConnectorFailureReason,
  ConnectorSettings,
  ConnectorTiming,
  ConnectorUpdate,
  ModelInfo
} from './connector.js';
import type { EffectiveState } from './effective-state.js';
import type { InputState } from './input-state.js';
import type { DocumentDefaults } from './session.js';
import type { MusicalPosition, Timeline } from './timeline.js';

export type RendererLifecycle = 'initializing' | 'ready' | 'closing' | 'closed' | 'failed';
export type PlaybackStatus = 'stopped' | 'starting' | 'running' | 'holding' | 'stopping' | 'failed';

/** @deprecated Removed in 0.4 step 4. Use `ConnectorDescription`. */
export interface LegacyConnectorDescription extends ConnectorDescription {
  readonly supportsFlowControl: boolean;
}

/** @deprecated Removed in 0.4 step 4. Use `ConnectorAudioChunk`. */
export interface LegacyConnectorAudioChunk extends AudioFormat {
  readonly runId: string;
  readonly bytes: Uint8Array;
  readonly durationSeconds: number;
  readonly final?: boolean;
}

/** @deprecated Removed in 0.4 step 4. Use `AudioChunk`. */
export interface LegacyAudioChunk extends LegacyConnectorAudioChunk {
  readonly sequence: number;
}

export interface RendererWarning {
  readonly code: string;
  readonly message: string;
  readonly runId?: string;
}

export interface RendererFailure {
  readonly code: string;
  readonly message: string;
  readonly reason?: ConnectorFailureReason;
  readonly runId?: string;
  readonly retryable: boolean;
  // The raw transport close code, when the failure came from a closed connection.
  // See `ConnectorError`.
  readonly closeCode?: number;
}

export type ConnectorStreamStatus = 'streaming' | 'ended' | 'throttled';

export interface AudioSink {
  push(chunk: LegacyConnectorAudioChunk): void;
  status(status: ConnectorStreamStatus, runId: string): void;
  warning(warning: RendererWarning): void;
  failure(failure: RendererFailure): void;
}

/** @deprecated Removed in 0.4 step 4. Use `Connector`. */
export interface LegacyConnector {
  describe(): Promise<LegacyConnectorDescription>;
  open(settings: ConnectorSettings): Promise<void>;
  prepare(initialState: EffectiveState, config: ConnectorConfig): Promise<void>;
  start(sink: AudioSink, timing: ConnectorTiming, runId: string): Promise<void>;
  update(update: ConnectorUpdate, requestedBoundary: MusicalPosition): Promise<MusicalPosition>;
  stop(runId: string): Promise<void>;
  close(): Promise<void>;
  setGenerationPaused?(paused: boolean): Promise<void>;
  /**
   * Checks a configuration the host proposes, so the Renderer never has to
   * compile `configSchema`. Optional because `Connector` is a published interface.
   */
  validateConfig?(config: ConnectorConfig): ConnectorConfigValidation;
}

export interface RendererStatusEvent {
  readonly lifecycle: RendererLifecycle;
  readonly playback: PlaybackStatus;
  readonly runId?: string;
  /** What the provider last said about its own stream. */
  readonly stream?: ConnectorStreamStatus;
  /**
   * The Renderer is holding the connector back because its own buffer is deep,
   * which is not the same fact as `stream === 'throttled'` — that is the provider
   * reporting it slowed down. A host that conflates them cannot tell a model
   * struggling to keep up from one being deliberately restrained.
   */
  readonly throttled?: boolean;
  // Set once, on the stopped status a finite run emits when it reaches its
  // declared length, while `runId` is still present. `stream` keeps meaning
  // provider stream state only, so a provider that ends its stream early is not
  // mistaken for a piece that finished.
  readonly completed?: true;
}

export interface RendererPositionEvent {
  readonly runId: string;
  readonly position: MusicalPosition;
  readonly seconds: number;
  readonly loopIteration: number;
}

export interface RendererUpdateResult {
  readonly requestedPosition?: MusicalPosition;
  readonly appliedPosition?: MusicalPosition;
}

export interface RendererEventMap {
  readonly status: RendererStatusEvent;
  readonly position: RendererPositionEvent;
  readonly audio: LegacyAudioChunk;
  readonly warning: RendererWarning;
  readonly failure: RendererFailure;
}

export interface Renderer {
  load(timeline: Timeline, inputState: InputState): Promise<void>;
  updateState(inputState: InputState): Promise<RendererUpdateResult>;
  start(): Promise<string>;
  stop(): Promise<void>;
  close(): Promise<void>;
  on<K extends keyof RendererEventMap>(
    event: K,
    listener: (payload: RendererEventMap[K]) => void
  ): () => void;
  getCapabilities(): CapabilitiesTable;
  getModelInfo(): ModelInfo;
  getDefaults(): DocumentDefaults;
  updateDefaults(patch: Partial<DocumentDefaults>): Promise<DocumentDefaults>;
  getConnectorConfig(): ConnectorConfig;
  updateConnectorConfig(patch: ConnectorConfig): Promise<ConnectorConfig>;
  getConfigSchema(): ConnectorConfigSchema;
  /**
   * The musical position `seconds` after the current run's anchor, through the
   * live tempo map; `undefined` when nothing is loaded or playing. After a finite
   * run completes it may keep answering for that run, capped at its declared
   * end, until the next run starts or playback is stopped. Hosts use it
   * to place what a listener is actually hearing, which lags the Renderer's last
   * position event by whatever the audio path buffers.
   */
  positionAtSeconds?(seconds: number): MusicalPosition | undefined;
}
