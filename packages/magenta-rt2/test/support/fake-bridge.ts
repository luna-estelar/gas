// A scripted mrt2-bridge, faithful to PROTOCOL.md and the bridge's session code.
// Each socket the connector opens is recorded. Replies are computed the way the
// bridge computes them and delivered in order, either at once (`autoAnswer`) or
// one at a time by `reply()`, so a test controls timing but never the verdict.
// Anything a protocol-1 bridge never sends goes through `receiveRaw`.
import type { BridgeSocket } from '../../src/connector.js';
import { AUDIO_HEADER_BYTES, FRAMES_PER_PACKET } from '../../src/protocol.js';

export const SERVER_HELLO = {
  type: 'hello',
  protocol: 1,
  engine: { name: 'fake', revision: 'fake', model: 'fake' },
  audio: { encoding: 'pcm_s16le', sampleRate: 48_000, channels: 2, framesPerPacket: 7680 },
  maxPrompts: 6,
  controls: ['style', 'pause', 'temperature', 'topK']
};

/** A connection that is greeted but never starts generation is closed after this long. */
export const IDLE_TIMEOUT_SECONDS = 30;

type Message = Record<string, unknown>;

const encoder = new TextEncoder();

/** The bridge's prompt rules: 1–6 entries, 1–512 bytes of text, finite non-negative weights with a positive sum. */
function validPrompts(prompts: unknown): boolean {
  if (!Array.isArray(prompts) || prompts.length < 1 || prompts.length > 6) return false;
  let largest = 0;
  for (const prompt of prompts as Message[]) {
    if (typeof prompt.text !== 'string' || typeof prompt.weight !== 'number') return false;
    const bytes = encoder.encode(prompt.text).byteLength;
    if (bytes < 1 || bytes > 512 || !Number.isFinite(prompt.weight) || prompt.weight < 0) {
      return false;
    }
    largest = Math.max(largest, prompt.weight);
  }
  return largest > 0;
}

export class FakeSocket implements BridgeSocket {
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: Message[] = [];
  closedByClient: number | undefined;
  private readyState: 'connecting' | 'open' | 'closed' = 'connecting';
  private readonly unanswered: Message[] = [];
  greeted = false;
  private streaming = false;
  private paused = false;
  private position = 0;
  private pendingClose: (() => void) | undefined;
  private sequence = 0;

  constructor(
    readonly url: string,
    private readonly bridge: FakeBridge
  ) {}

  send(data: string): void {
    // WebSocket.send throws while connecting and drops silently once closing.
    if (this.readyState === 'connecting') throw new Error('InvalidStateError');
    if (this.readyState === 'closed') return;
    const message = JSON.parse(data) as Message;
    this.sent.push(message);
    this.unanswered.push(message);
    if (this.bridge.autoAnswer) queueMicrotask(() => this.reply());
  }

  close(code = 1005): void {
    if (this.readyState === 'closed') return;
    this.closedByClient = code;
    this.end(code);
  }

  get released(): boolean {
    return this.closedByClient !== undefined;
  }

  /** Commands sent after the hello, without their ids. */
  commands(): Message[] {
    return this.sent
      .filter((message) => message.type !== 'hello')
      .map(({ id: _id, ...rest }) => rest);
  }

  open(): void {
    this.readyState = 'open';
    this.onopen?.();
  }

  /** Answer the oldest unanswered message as the bridge would. */
  reply(): void {
    const message = this.unanswered.shift();
    if (message === undefined || this.readyState !== 'open') return;
    if (!this.greeted) {
      this.answerHello(message);
      return;
    }
    // Parsing rejects a bad field before the session sees the command's state.
    const id = Number.isInteger(message.id) && (message.id as number) > 0 ? message.id : undefined;
    const error = (code: string, retryable = false) =>
      this.receive({ type: 'error', id, code, message: 'x', retryable });
    if (id === undefined) return error('invalid-command');
    switch (message.type) {
      case 'start': {
        const { temperature, topK } = message as { temperature?: unknown; topK?: unknown };
        if (
          !validPrompts(message.prompts) ||
          (temperature !== undefined &&
            !(typeof temperature === 'number' && temperature >= 0 && temperature <= 4)) ||
          (topK !== undefined &&
            !(Number.isInteger(topK) && (topK as number) >= 1 && (topK as number) <= 1024))
        ) {
          return error('invalid-command');
        }
        if (this.streaming) return error('invalid-state');
        this.streaming = true;
        this.paused = false;
        this.position = 0;
        this.sequence = 0;
        break;
      }
      case 'style':
        if (!validPrompts(message.prompts)) return error('invalid-command');
        if (!this.streaming) return error('invalid-state');
        break;
      case 'pause':
        if (typeof message.paused !== 'boolean') return error('invalid-command');
        if (!this.streaming) return error('invalid-state');
        this.paused = message.paused;
        break;
      case 'stop':
        this.streaming = false;
        break;
      default:
        return error('invalid-command');
    }
    this.receive({ type: 'ack', id });
  }

  /** Answer the oldest unanswered `start` or `style` with the encoder failing. */
  failEncoding(): void {
    const message = this.unanswered.shift();
    if (message?.type !== 'start' && message?.type !== 'style') {
      throw new Error('Only start and style encode prompts.');
    }
    this.receive({
      type: 'error',
      id: message.id,
      code: 'prompt-encode-failed',
      message: 'x',
      retryable: true
    });
  }

  /** One packet, contiguous with the last; only while generating and not paused. */
  audio(frames = FRAMES_PER_PACKET): void {
    if (this.readyState === 'closed') return;
    if (!this.streaming || this.paused) throw new Error('The bridge sends no audio now.');
    const bytes = new Uint8Array(AUDIO_HEADER_BYTES + frames * 4);
    bytes.set([0x4d, 0x52, 0x54, 0x31]);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, this.sequence++, true);
    view.setBigUint64(8, BigInt(this.position), true);
    this.position += frames;
    this.onmessage?.({ data: bytes.buffer });
  }

  /** The engine stopped producing audio: an unsolicited error, then close 4500. */
  engineFailure(): void {
    this.receive({
      type: 'error',
      code: 'engine-failure',
      message: 'The engine stopped producing audio.',
      retryable: true
    });
    this.end(4500);
  }

  /** The bridge's idle watchdog: greeted, never started. */
  idle(): void {
    if (!this.greeted || this.streaming) throw new Error('Only an idle connection times out.');
    this.end(4408);
  }

  /** The connection drops without a close frame. */
  drop(): void {
    this.onerror?.();
    this.end(1006);
  }

  /** Something no protocol-1 bridge sends, for the connector's own defences. */
  receiveRaw(message: unknown): void {
    this.receive(message);
  }

  private answerHello(message: Message): void {
    const refuse = (code: string, closeCode: number) => {
      this.receive({ type: 'error', code, message: 'x', retryable: false });
      this.end(closeCode);
    };
    if (message.type !== 'hello') return refuse('invalid-command', 4400);
    if (message.protocol !== 1) return refuse('unsupported-protocol', 4400);
    if (this.bridge.token !== undefined && message.token !== this.bridge.token) {
      return refuse('unauthorized', 4401);
    }
    if (this.bridge.busy || this.bridge.sockets.some((other) => other !== this && other.active)) {
      return refuse('busy', 4409);
    }
    this.greeted = true;
    this.receive(SERVER_HELLO);
  }

  private get active(): boolean {
    return this.greeted && this.readyState === 'open';
  }

  private receive(message: unknown): void {
    if (this.readyState === 'closed') return;
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  private end(code: number): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.streaming = false;
    this.pendingClose = () => this.onclose?.({ code });
    if (!this.bridge.slowCloses) queueMicrotask(() => this.finishClose());
  }

  /** The close event, which `slowCloses` holds back until now. */
  finishClose(): void {
    const close = this.pendingClose;
    this.pendingClose = undefined;
    close?.();
  }
}

export class FakeBridge {
  readonly sockets: FakeSocket[] = [];
  autoAnswer = false;
  /** The bridge was started with `--token`. */
  token: string | undefined;
  /** A session this fake does not model, such as another client's, holds the engine. */
  busy = false;
  /** Close events wait for `finishClose()`, as a slow closing handshake can. */
  slowCloses = false;

  readonly createSocket = (url: string): BridgeSocket => {
    const socket = new FakeSocket(url, this);
    this.sockets.push(socket);
    if (this.autoAnswer) queueMicrotask(() => socket.open());
    return socket;
  };

  get last(): FakeSocket {
    return this.sockets.at(-1)!;
  }
}
