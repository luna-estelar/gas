// The renderer's own types. The renderer is internal to the session, so none of
// these are public API.
import type {
  AudioChunk,
  CapabilitiesTable,
  Connector,
  ConnectorConfig,
  ConnectorConfigSchema,
  ConnectorFailureReason,
  DocumentDefaults,
  GenerationPositionEvent,
  InputState,
  ModelInfo,
  MusicalPosition,
  Timeline
} from '../protocol/index.js';

/** A failure, classified without any provider text. */
export interface RendererFailure {
  readonly code: string;
  readonly message: string;
  readonly reason: ConnectorFailureReason;
  readonly retryable: boolean;
  /** The raw transport close code, when the failure came from a closed connection. */
  readonly closeCode?: number;
}

export interface RendererWarning {
  readonly code: string;
  readonly message: string;
}

/** How a Play the renderer ended itself came to an end. Stop is the caller's own doing. */
export type RendererEnd =
  | { readonly reason: 'finished' }
  | { readonly reason: 'failed'; readonly failure: RendererFailure };

export interface RendererUpdateResult {
  readonly requestedPosition?: MusicalPosition;
  readonly appliedPosition?: MusicalPosition;
}

export interface RendererEventMap {
  readonly audio: AudioChunk;
  readonly generationPosition: GenerationPositionEvent;
  readonly warning: RendererWarning;
  readonly ended: RendererEnd;
}

export interface Renderer {
  load(timeline: Timeline, inputState: InputState): void;
  /** Takes a new input state. While playing, the connection gets it too. */
  update(inputState: InputState): Promise<RendererUpdateResult>;
  /**
   * Opens a connection and resolves once it is open (rules 1 and 2). Rejects
   * with `RendererError` code `cancelled` if Stop or Close came first, or with
   * the startup failure.
   */
  play(): Promise<void>;
  /** Ends the Play at once. The connection closes in the background. */
  stop(): void;
  close(): void;
  setConnector(connector: Connector, config?: ConnectorConfig): void;
  on<K extends keyof RendererEventMap>(
    event: K,
    listener: (payload: RendererEventMap[K]) => void
  ): () => void;
  getCapabilities(): CapabilitiesTable;
  getModelInfo(): ModelInfo;
  getDefaults(): DocumentDefaults;
  updateDefaults(patch: Partial<DocumentDefaults>): DocumentDefaults;
  getConnectorConfig(): ConnectorConfig;
  updateConnectorConfig(patch: ConnectorConfig): ConnectorConfig;
  getConfigSchema(): ConnectorConfigSchema;
  /**
   * The musical position `seconds` after bar 1 of the current Play, for a host
   * placing buffered audio. After a finite piece finishes it keeps answering,
   * capped at the declared end, until the next Play or a Stop.
   */
  positionAtSeconds(seconds: number): MusicalPosition | undefined;
}
