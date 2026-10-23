// A scripted bridge on the other end of the connector's sockets. Each socket the
// connector opens is recorded; tests open it, answer it and close it by hand, or
// let `autoAnswer` greet and ack everything.
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

export class FakeSocket implements BridgeSocket {
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: Array<Record<string, unknown>> = [];
  closedByClient: number | undefined;

  constructor(
    readonly url: string,
    private readonly autoAnswering: () => boolean
  ) {}

  send(data: string): void {
    const message = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(message);
    if (!this.autoAnswering()) return;
    if (message.type === 'hello') queueMicrotask(() => this.receive(SERVER_HELLO));
    else queueMicrotask(() => this.receive({ type: 'ack', id: message.id }));
  }

  close(code = 1005): void {
    this.closedByClient ??= code;
  }

  get released(): boolean {
    return this.closedByClient !== undefined;
  }

  /** Commands sent after the hello, without their ids. */
  commands(): Array<Record<string, unknown>> {
    return this.sent
      .filter((message) => message.type !== 'hello')
      .map(({ id: _id, ...rest }) => rest);
  }

  lastId(): number {
    return this.sent.at(-1)!.id as number;
  }

  open(): void {
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  ack(id = this.lastId()): void {
    this.receive({ type: 'ack', id });
  }

  audio(position: number, frames = FRAMES_PER_PACKET, sequence = 0): void {
    const bytes = new Uint8Array(AUDIO_HEADER_BYTES + frames * 4);
    bytes.set([0x4d, 0x52, 0x54, 0x31]);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, sequence, true);
    view.setBigUint64(8, BigInt(position), true);
    this.onmessage?.({ data: bytes.buffer });
  }

  serverClose(code: number): void {
    this.onclose?.({ code });
  }
}

export class FakeBridge {
  readonly sockets: FakeSocket[] = [];
  autoAnswer = false;

  readonly createSocket = (url: string): BridgeSocket => {
    const socket = new FakeSocket(url, () => this.autoAnswer);
    this.sockets.push(socket);
    if (this.autoAnswer) queueMicrotask(() => socket.open());
    return socket;
  };

  get last(): FakeSocket {
    return this.sockets.at(-1)!;
  }
}
