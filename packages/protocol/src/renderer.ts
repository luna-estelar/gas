import type { CapabilitiesTable } from './capabilities.js';
import type { EffectiveState } from './effective-state.js';
import type { InputState } from './input-state.js';
import type { MusicalPosition, TimeSignature, Timeline } from './timeline.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ClockTimer {
  readonly token: unknown;
}

export interface MonotonicClock {
  now(): number;
  schedule(deadlineSeconds: number, callback: () => void): ClockTimer;
  cancel(timer: ClockTimer): void;
}

export type RendererLifecycle = 'initializing' | 'ready' | 'closing' | 'closed' | 'failed';
export type PlaybackStatus = 'stopped' | 'starting' | 'running' | 'holding' | 'stopping' | 'failed';
export type ConnectorFailureReason = 'network' | 'auth' | 'quota' | 'provider' | 'internal';
export type SampleFormat = 's16le' | (string & {});

export interface AudioFormat {
  readonly codec: string;
  readonly sampleFormat: SampleFormat;
  readonly sampleRate: number;
  readonly channels: number;
}

export interface ModelInfo extends AudioFormat {
  readonly connectorId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly chunkDurationSeconds: number;
}

export interface RendererDefaults {
  readonly tempo?: number;
  readonly timeSignature?: TimeSignature;
  readonly key?: string;
}

export type ConnectorSettings = JsonObject;
export type ConnectorConfig = JsonObject;
export type ConnectorConfigSchema = JsonObject;

export interface ConnectorDescription {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: CapabilitiesTable;
  readonly model: ModelInfo;
  readonly configSchema: ConnectorConfigSchema;
  readonly defaultConfig: ConnectorConfig;
  readonly supportsFlowControl: boolean;
}

export interface ConnectorTiming {
  readonly tempo: number;
  readonly timeSignature: TimeSignature;
  readonly key?: string;
  readonly secondsPerBar: number;
}

export interface ConnectorNotation {
  readonly trackId: string;
  readonly intent: 'notes' | 'motif';
  readonly source: string;
  readonly midi?: Uint8Array;
}

export interface ConnectorUpdate {
  readonly state: EffectiveState;
  readonly notation?: readonly ConnectorNotation[];
}

export interface ConnectorAudioChunk extends AudioFormat {
  readonly runId: string;
  readonly bytes: Uint8Array;
  readonly durationSeconds: number;
  readonly final?: boolean;
}

export interface AudioChunk extends ConnectorAudioChunk {
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
}

export type ConnectorStreamStatus = 'streaming' | 'ended' | 'throttled';

export interface AudioSink {
  push(chunk: ConnectorAudioChunk): void;
  status(status: ConnectorStreamStatus, runId: string): void;
  warning(warning: RendererWarning): void;
  failure(failure: RendererFailure): void;
}

export interface Connector {
  describe(): Promise<ConnectorDescription>;
  open(settings: ConnectorSettings): Promise<void>;
  prepare(initialState: EffectiveState, config: ConnectorConfig): Promise<void>;
  start(sink: AudioSink, timing: ConnectorTiming, runId: string): Promise<void>;
  update(update: ConnectorUpdate, requestedBoundary: MusicalPosition): Promise<MusicalPosition>;
  stop(runId: string): Promise<void>;
  close(): Promise<void>;
  setGenerationPaused?(paused: boolean): Promise<void>;
}

export interface RendererStatusEvent {
  readonly lifecycle: RendererLifecycle;
  readonly playback: PlaybackStatus;
  readonly runId?: string;
  readonly stream?: ConnectorStreamStatus;
  readonly throttled?: boolean;
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
  readonly audio: AudioChunk;
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
  getDefaults(): RendererDefaults;
  updateDefaults(patch: Partial<RendererDefaults>): Promise<RendererDefaults>;
  getConnectorConfig(): ConnectorConfig;
  updateConnectorConfig(patch: ConnectorConfig): Promise<ConnectorConfig>;
  getConfigSchema(): ConnectorConfigSchema;
}
