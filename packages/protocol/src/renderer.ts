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
  // The raw transport close code, 1000-4999, when the failure came from a closed
  // connection. Passed through unclassified: a connector classifies the standard
  // codes and leaves the application range (4000-4999) for the host to interpret.
  readonly closeCode?: number;
}

export type ConnectorStreamStatus = 'streaming' | 'ended' | 'throttled';

export interface AudioSink {
  push(chunk: ConnectorAudioChunk): void;
  status(status: ConnectorStreamStatus, runId: string): void;
  warning(warning: RendererWarning): void;
  failure(failure: RendererFailure): void;
}

/**
 * One thing wrong with a proposed connector configuration. Deliberately not the
 * Renderer's AJV-shaped problem: a hand-written validator should not have to
 * imitate a schema compiler to report a bad value.
 */
export interface ConnectorConfigProblem {
  /** JSON Pointer to the offending member, '' for the root. */
  readonly path: string;
  /** Stable machine code, e.g. 'unknown-member', 'out-of-range', 'wrong-type'. */
  readonly code: string;
  /** Safe, fixed text. Never provider or caller input. */
  readonly message: string;
}

export type ConnectorConfigValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly problems: readonly ConnectorConfigProblem[] };

export interface Connector {
  describe(): Promise<ConnectorDescription>;
  open(settings: ConnectorSettings): Promise<void>;
  prepare(initialState: EffectiveState, config: ConnectorConfig): Promise<void>;
  start(sink: AudioSink, timing: ConnectorTiming, runId: string): Promise<void>;
  update(update: ConnectorUpdate, requestedBoundary: MusicalPosition): Promise<MusicalPosition>;
  stop(runId: string): Promise<void>;
  close(): Promise<void>;
  setGenerationPaused?(paused: boolean): Promise<void>;
  /**
   * Checks a configuration the host proposes, without compiling a schema. The
   * Renderer calls this instead of validating `configSchema` itself, so a
   * session stays usable under a Content Security Policy without
   * `'unsafe-eval'`. Optional because `Connector` is a published interface; a
   * connector that omits it gets no configuration validation.
   */
  validateConfig?(config: ConnectorConfig): ConnectorConfigValidation;
}

export interface RendererStatusEvent {
  readonly lifecycle: RendererLifecycle;
  readonly playback: PlaybackStatus;
  readonly runId?: string;
  readonly stream?: ConnectorStreamStatus;
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
  /**
   * The musical position `seconds` after the current run's anchor, through the
   * live tempo map; `undefined` when nothing is loaded or playing. Hosts use it
   * to place what a listener is actually hearing, which lags the Renderer's last
   * position event by whatever the audio path buffers.
   */
  positionAtSeconds?(seconds: number): MusicalPosition | undefined;
}
