import { createMagentaRt2ConnectorWithDependencies } from '../src/connector.js';
import { describeConnectorConformance } from '../../../test/support/connector-conformance.js';
import { VirtualClock } from '../../../test/support/virtual-clock.js';
import { FakeBridge, SERVER_HELLO } from './support/fake-bridge.js';

describeConnectorConformance('Magenta RT2', () => {
  const clock = new VirtualClock();
  const bridge = new FakeBridge();
  const connector = createMagentaRt2ConnectorWithDependencies({
    clock,
    createSocket: bridge.createSocket
  });
  return {
    connector,
    clock,
    settings: { endpoint: 'ws://127.0.0.1:8765' },
    config: {},
    state: {
      globals: { tempo: 96 },
      tracks: [{ trackId: 'pad', name: 'pad', description: 'soft chords', active: true }]
    },
    timing: { tempo: 96, timeSignature: { beatsPerBar: 4, beatUnit: 4 }, secondsPerBar: 2.5 },
    // A bridge connection is up once the socket opens and the hellos are exchanged.
    connect: (index) => {
      const socket = bridge.sockets[index]!;
      socket.open();
      socket.receive(SERVER_HELLO);
    },
    ready: (index) => bridge.sockets[index]!.ack(),
    audio: (index) => bridge.sockets[index]!.audio(0),
    released: (index) => bridge.sockets[index]!.released
  };
});
