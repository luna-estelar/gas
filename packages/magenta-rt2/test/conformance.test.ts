// Magenta RT2 against the connector conformance suite, over the fake bridge.
// Magenta-specific behaviour, such as the close-code table, is in transport.test.ts.
import { describeConnector } from '@luna-estelar/gas-connector-test';
import { createMagentaRt2ConnectorWithDependencies } from '../src/connector.js';
import { VirtualClock } from '../../../test/support/virtual-clock.js';
import { flushAsync } from '../../../test/support/deferred.js';
import { FakeBridge } from './support/fake-bridge.js';

describeConnector('Magenta RT2', () => {
  const clock = new VirtualClock();
  const bridge = new FakeBridge();
  // The real bridge serves one session at a time, and GAS never holds two
  // connections at once. The suite's two-connection check is about connector
  // state, so the fake serves both.
  bridge.manySessions = true;
  // Each check may connect several times. Every connect starts with a bridge
  // that accepts the token and waits for `open()` before answering.
  const connector = createMagentaRt2ConnectorWithDependencies(
    { endpoint: 'ws://127.0.0.1:8765', token: 'sesame' },
    {
      clock,
      createSocket: (url) => {
        bridge.autoAnswer = false;
        bridge.token = 'sesame';
        return bridge.createSocket(url);
      }
    }
  );

  /** Opens the pending socket; the bridge answers everything from here. */
  async function openSocket(): Promise<void> {
    bridge.autoAnswer = true;
    bridge.last.open();
    await flushAsync();
  }

  return {
    connector,
    open: openSocket,
    transportsOpened: () => bridge.sockets.length,
    transportsOpen: () => bridge.sockets.filter((socket) => socket.live).length,
    // Keepalives only hold the socket open, so they don't count as sends.
    sent: () =>
      bridge.sockets.reduce(
        (total, socket) =>
          total + socket.commands().filter((command) => command.type !== 'keepalive').length,
        0
      ),
    generating: () => bridge.last?.generating ?? false,
    failures: [
      {
        name: 'token refused (4401)',
        when: 'connect',
        async cause() {
          bridge.token = 'other';
          await openSocket();
        },
        expect: { reason: 'auth', retryable: false }
      },
      {
        name: 'connect timeout',
        when: 'connect',
        cause: () => clock.advanceBy(10),
        expect: { reason: 'network', retryable: true }
      },
      {
        name: 'engine failure while playing (4500)',
        when: 'playing',
        cause: () => bridge.last.engineFailure(),
        expect: { reason: 'provider', retryable: true }
      },
      {
        name: 'socket lost while playing (1006)',
        when: 'playing',
        cause: () => bridge.last.drop(),
        expect: { reason: 'network', retryable: true }
      }
    ]
  };
});
