// A scripted `client.live.music`, faithful to the pinned @google/genai source
// (LiveMusic.connect and LiveMusicSession) over `ws`:
// - `connect` resolves only once the socket opens; a socket that fails first
//   reports error and close, and `connect` never settles;
// - setup completes, and the server sends anything at all, only after open;
// - session sends never wait on the server, and after close are dropped;
//   `setWeightedPrompts` rejects an empty list, nothing else rejects;
// - `close()` is followed by a close event, and messages already in flight can
//   still arrive until it fires.
import type { LiveMusicServerMessage } from '@google/genai';
import type {
  LyriaRtConnectorDependencies,
  LyriaRtMusicSession,
  LyriaRtSdkClient
} from '../../src/connector.js';

type Callbacks = Parameters<LyriaRtSdkClient['connect']>[0]['callbacks'];
type ClientOptions = Parameters<LyriaRtConnectorDependencies['createClient']>[0];
type ServerMessage = Omit<LiveMusicServerMessage, 'audioChunk'>;

export type SessionCall = { readonly kind: string; readonly value?: unknown };

export class FakeConnection {
  readonly calls: SessionCall[] = [];
  private readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';

  constructor(
    readonly model: string,
    private readonly callbacks: Callbacks,
    private readonly resolveConnect: (session: LyriaRtMusicSession) => void
  ) {}

  readonly session: LyriaRtMusicSession = {
    setWeightedPrompts: async ({ weightedPrompts }) => {
      if (weightedPrompts.length === 0) {
        throw new Error('Weighted prompts must be set and contain at least one entry.');
      }
      this.record('prompts', weightedPrompts);
    },
    setMusicGenerationConfig: async ({ musicGenerationConfig }) =>
      this.record('config', musicGenerationConfig),
    play: () => this.record('play'),
    pause: () => this.record('pause'),
    stop: () => this.record('stop'),
    resetContext: () => this.record('reset'),
    close: () => {
      this.calls.push({ kind: 'close' });
      if (this.readyState !== 'open') return;
      this.readyState = 'closing';
      queueMicrotask(() => this.end(1005));
    }
  };

  get released(): boolean {
    return this.calls.some((call) => call.kind === 'close');
  }

  kinds(): string[] {
    return this.calls.map((call) => call.kind);
  }

  open(): void {
    this.readyState = 'open';
    this.resolveConnect(this.session);
  }

  setupComplete(): void {
    this.message({ setupComplete: {} });
  }

  audio(...chunks: number[][]): void {
    this.message({
      serverContent: {
        audioChunks: chunks.map((bytes) => ({ data: Buffer.from(bytes).toString('base64') }))
      }
    });
  }

  message(message: ServerMessage): void {
    if (this.readyState === 'connecting')
      throw new Error('Nothing arrives before the socket opens.');
    if (this.readyState === 'closed') return;
    this.callbacks.onmessage(message);
  }

  /** The server closes with a status, as Google does for a refused key or an internal error. */
  serverClose(code: number): void {
    if (this.readyState === 'connecting') throw new Error('A server close needs an open socket.');
    this.end(code);
  }

  /** The transport fails: an error event, then an abnormal close. */
  fail(): void {
    if (this.readyState === 'closed') return;
    this.callbacks.onerror();
    this.end(1006);
  }

  private record(kind: string, value?: unknown): void {
    if (this.readyState !== 'open') return;
    this.calls.push(value === undefined ? { kind } : { kind, value });
  }

  private end(code: number): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.callbacks.onclose({ code });
  }
}

export class FakeLiveMusic {
  readonly options: ClientOptions[] = [];
  readonly connections: FakeConnection[] = [];

  readonly createClient: LyriaRtConnectorDependencies['createClient'] = (options) => {
    this.options.push(options);
    return {
      connect: ({ model, callbacks }) =>
        new Promise<LyriaRtMusicSession>((resolve) => {
          this.connections.push(new FakeConnection(model, callbacks, resolve));
        })
    };
  };

  get last(): FakeConnection {
    return this.connections.at(-1)!;
  }
}
