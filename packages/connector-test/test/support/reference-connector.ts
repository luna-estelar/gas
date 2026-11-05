// A minimal connector that keeps the contract, over an in-memory provider, and
// a flag for each way to break it. The suite's own tests run every check
// against the correct one and against each broken one.
import { ConnectorError } from '@luna-estelar/gas/protocol';
import type { Connection, Connector } from '@luna-estelar/gas/protocol';
import { fakeDescription } from '../../../../test/support/fake-connection.js';
import type { ConnectorHarness } from '../../src/index.js';

export interface Breakage {
  /** Opens a transport before noticing the signal already aborted. */
  readonly opensWhenAborted?: boolean;
  /** Waits for the provider connect whatever the signal does. */
  readonly ignoresAbort?: boolean;
  /** Leaves a transport that opens after the abort open. */
  readonly leaksLateTransport?: boolean;
  /** Keeps sending after close(). */
  readonly sendsAfterClose?: boolean;
  /** Rejects connect() with a plain Error. */
  readonly plainErrors?: boolean;
  /** Classifies a refused connect as a provider failure. */
  readonly wrongReason?: boolean;
  /** Calls onError twice for one failure. */
  readonly reportsTwice?: boolean;
  /** pause() leaves the provider generating. */
  readonly pauseDoesNothing?: boolean;
  /** Every connect() shares the first transport. */
  readonly sharesTransport?: boolean;
}

export class FakeTransport {
  state: 'connecting' | 'open' | 'closed' = 'connecting';
  generating = false;
  /** Every send attempt, so a send after close is counted. */
  sent = 0;
  onDrop: () => void = () => undefined;

  get open(): boolean {
    return this.state !== 'closed';
  }

  send(kind: 'play' | 'pause' | 'prompts'): void {
    this.sent += 1;
    if (this.state !== 'open') return;
    if (kind === 'play') this.generating = true;
    if (kind === 'pause') this.generating = false;
  }

  close(): void {
    this.state = 'closed';
    this.generating = false;
  }

  /** The provider drops the connection. */
  drop(): void {
    if (this.state !== 'open') return;
    this.close();
    this.onDrop();
  }
}

interface PendingConnect {
  readonly transport: FakeTransport;
  resolve(transport: FakeTransport): void;
  reject(error: unknown): void;
}

/** Each connect registers a transport at once; it opens on open() or fails on refuse(). */
export class FakeProvider {
  readonly transports: FakeTransport[] = [];
  private pending: PendingConnect[] = [];

  connect(): Promise<FakeTransport> {
    const transport = new FakeTransport();
    this.transports.push(transport);
    return new Promise((resolve, reject) => this.pending.push({ transport, resolve, reject }));
  }

  open(): void {
    for (const { transport, resolve } of this.pending.splice(0)) {
      if (transport.state === 'connecting') transport.state = 'open';
      resolve(transport);
    }
  }

  refuse(): void {
    for (const { transport, reject } of this.pending.splice(0)) {
      transport.close();
      reject(new Error('refused'));
    }
  }
}

function cancelled(): ConnectorError {
  return new ConnectorError({ code: 'reference-cancelled', reason: 'internal', retryable: true });
}

export function createReferenceConnector(provider: FakeProvider, broken: Breakage = {}): Connector {
  let shared: FakeTransport | undefined;

  async function openTransport(signal: AbortSignal): Promise<FakeTransport> {
    if (broken.sharesTransport && shared !== undefined) return shared;
    const connecting = provider.connect();
    if (broken.ignoresAbort) return connecting;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        reject(cancelled());
        connecting.then(
          (late) => {
            if (!broken.leaksLateTransport) late.close();
          },
          () => undefined
        );
      };
      signal.addEventListener('abort', onAbort, { once: true });
      connecting.then(
        (transport) => {
          signal.removeEventListener('abort', onAbort);
          resolve(transport);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        }
      );
    });
  }

  return {
    description: fakeDescription({ id: 'reference' }),
    async connect({ signal, onError }): Promise<Connection> {
      if (signal.aborted) {
        if (broken.opensWhenAborted) void provider.connect();
        throw cancelled();
      }
      let transport: FakeTransport;
      try {
        transport = await openTransport(signal);
      } catch (error) {
        if (ConnectorError.isConnectorError(error)) throw error;
        if (broken.plainErrors) throw new Error('refused');
        throw new ConnectorError({
          code: 'reference-refused',
          reason: broken.wrongReason ? 'provider' : 'auth',
          retryable: false
        });
      }
      if (signal.aborted) {
        transport.close();
        throw cancelled();
      }
      if (broken.sharesTransport) shared = transport;
      let closed = false;
      transport.onDrop = () => {
        const error = new ConnectorError({
          code: 'reference-dropped',
          reason: 'network',
          retryable: true
        });
        onError(error);
        if (broken.reportsTwice) onError(error);
      };
      const send = (kind: 'play' | 'pause' | 'prompts') => {
        if (!closed || broken.sendsAfterClose) transport.send(kind);
      };
      send('prompts');
      send('play');
      return {
        async update(_update, requested) {
          if (closed) throw cancelled();
          send('prompts');
          return requested;
        },
        async pause() {
          if (!broken.pauseDoesNothing) send('pause');
        },
        async resume() {
          send('play');
        },
        async close() {
          closed = true;
          transport.close();
        }
      };
    }
  };
}

export function referenceHarness(broken: Breakage = {}): ConnectorHarness {
  const provider = new FakeProvider();
  return {
    connector: createReferenceConnector(provider, broken),
    timeoutMs: 50,
    open: () => provider.open(),
    transportsOpened: () => provider.transports.length,
    transportsOpen: () => provider.transports.filter((transport) => transport.open).length,
    sent: () => provider.transports.reduce((total, transport) => total + transport.sent, 0),
    generating: () => provider.transports.at(-1)?.generating ?? false,
    failures: [
      {
        name: 'refused',
        when: 'connect',
        cause: () => provider.refuse(),
        expect: { reason: 'auth', retryable: false }
      },
      {
        name: 'dropped',
        when: 'playing',
        cause: () => provider.transports.at(-1)!.drop(),
        expect: { reason: 'network', retryable: true }
      }
    ]
  };
}
