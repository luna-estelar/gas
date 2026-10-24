import { createLyriaRtConnectorWithDependencies } from '../src/connector.js';
import { DEFAULT_LYRIA_RT_CONFIG } from '../src/config.js';
import { describeConnectorConformance } from '../../../test/support/connector-conformance.js';
import { VirtualClock } from '../../../test/support/virtual-clock.js';
import { FakeLiveMusic } from './support/fake-sdk.js';

describeConnectorConformance('Lyria RealTime', () => {
  const clock = new VirtualClock();
  const sdk = new FakeLiveMusic();
  const connector = createLyriaRtConnectorWithDependencies({
    clock,
    setupTimeoutSeconds: 15,
    createClient: sdk.createClient
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
    connect: (index) => sdk.connections[index]!.open(),
    ready: (index) => sdk.connections[index]!.setupComplete(),
    audio: (index) => sdk.connections[index]!.audio([1, 2, 3, 4]),
    released: (index) => sdk.connections[index]!.released
  };
});
