import type { LyriaRtMusicSession, LyriaRtSdkClient } from '../src/connector.js';
import { createLyriaRtConnectorWithDependencies } from '../src/connector.js';
import { DEFAULT_LYRIA_RT_CONFIG } from '../src/config.js';
import { describeConnectorConformance } from '../../../test/support/connector-conformance.js';
import { VirtualClock } from '../../../test/support/virtual-clock.js';

type Callbacks = Parameters<LyriaRtSdkClient['connect']>[0]['callbacks'];

interface Connection {
  readonly callbacks: Callbacks;
  readonly resolve: () => void;
  closed: boolean;
}

describeConnectorConformance('Lyria RealTime', () => {
  const clock = new VirtualClock();
  const connections: Connection[] = [];
  const connector = createLyriaRtConnectorWithDependencies({
    clock,
    setupTimeoutSeconds: 15,
    createClient: () => ({
      connect: ({ callbacks }) =>
        new Promise<LyriaRtMusicSession>((resolve) => {
          const connection: Connection = {
            callbacks,
            resolve: () => resolve(session),
            closed: false
          };
          const session: LyriaRtMusicSession = {
            setWeightedPrompts: async () => undefined,
            setMusicGenerationConfig: async () => undefined,
            play: () => undefined,
            pause: () => undefined,
            stop: () => undefined,
            resetContext: () => undefined,
            close: () => {
              connection.closed = true;
            }
          };
          connections.push(connection);
        })
    })
  });
  return {
    connector,
    clock,
    settings: { apiKey: 'test-key' },
    config: {
      prompt: { ...DEFAULT_LYRIA_RT_CONFIG.prompt, transitionDurationMs: 0, transitionSteps: 1 },
      generation: DEFAULT_LYRIA_RT_CONFIG.generation
    },
    state: {
      globals: { flavor: { kind: 'text', text: 'warm' }, tempo: 96 },
      tracks: [{ trackId: 'pad', name: 'pad', description: 'soft chords', active: true }]
    },
    timing: { tempo: 96, timeSignature: { beatsPerBar: 4, beatUnit: 4 }, secondsPerBar: 2.5 },
    connect: (index) => connections[index]!.resolve(),
    ready: (index) => connections[index]!.callbacks.onmessage({ setupComplete: {} }),
    audio: (index) =>
      connections[index]!.callbacks.onmessage({
        serverContent: { audioChunks: [{ data: Buffer.from([1, 2, 3, 4]).toString('base64') }] }
      }),
    released: (index) => connections[index]!.closed
  };
});
