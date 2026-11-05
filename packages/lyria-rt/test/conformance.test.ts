// Lyria RealTime against the connector conformance suite, over the fake SDK.
// Lyria-specific behaviour, such as the close-code table, is in transport.test.ts.
import { describeConnector } from '@luna-estelar/gas-connector-test';
import { DEFAULT_LYRIA_RT_CONFIG } from '../src/config.js';
import { createLyriaRtConnectorWithDependencies } from '../src/connector.js';
import { VirtualClock } from '../../../test/support/virtual-clock.js';
import { flushAsync } from '../../../test/support/deferred.js';
import { FakeLiveMusic } from './support/fake-sdk.js';

const SETUP_TIMEOUT_SECONDS = 15;

describeConnector('Lyria RealTime', () => {
  const clock = new VirtualClock();
  const sdk = new FakeLiveMusic();
  const connector = createLyriaRtConnectorWithDependencies(
    { apiKey: 'test-key' },
    { clock, setupTimeoutSeconds: SETUP_TIMEOUT_SECONDS, createClient: sdk.createClient }
  );

  /** Opens the pending socket, short of setup. */
  async function openSocket(): Promise<void> {
    sdk.last.open();
    await flushAsync();
  }

  return {
    connector,
    async open() {
      await openSocket();
      sdk.last.setupComplete();
    },
    transportsOpened: () => sdk.connections.length,
    transportsOpen: () =>
      sdk.connections.filter((socket) => !socket.released && !socket.closed).length,
    sent: () =>
      sdk.connections.reduce(
        (total, socket) => total + socket.calls.filter((call) => call.kind !== 'close').length,
        0
      ),
    generating: () => {
      const controls = sdk.last?.kinds().filter((kind) => kind === 'play' || kind === 'pause');
      return controls?.at(-1) === 'play';
    },
    // Lets a crossfade run to the end, so a send it schedules has its chance to fire.
    async settle() {
      await flushAsync();
      clock.advanceBy(DEFAULT_LYRIA_RT_CONFIG.prompt.transitionDurationMs / 1000);
      await flushAsync();
    },
    failures: [
      {
        name: 'key refused before setup (1008)',
        when: 'connect',
        async cause() {
          await openSocket();
          sdk.last.serverClose(1008);
        },
        expect: { reason: 'auth', retryable: false }
      },
      {
        name: 'setup timeout',
        when: 'connect',
        async cause() {
          await openSocket();
          clock.advanceBy(SETUP_TIMEOUT_SECONDS);
        },
        expect: { reason: 'network', retryable: true }
      },
      {
        name: 'server error while playing (1011)',
        when: 'playing',
        cause: () => sdk.last.serverClose(1011),
        expect: { reason: 'provider', retryable: true }
      },
      {
        name: 'socket lost while playing (1006)',
        when: 'playing',
        cause: () => sdk.last.fail(),
        expect: { reason: 'network', retryable: true }
      }
    ]
  };
});
