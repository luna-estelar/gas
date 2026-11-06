// Each real connector behind the real renderer, falling back to the run's
// defaults once an app value is cleared. Starting with the override in place
// is the case that matters: the connector must not mistake the initial effective
// tempo for the default it returns to.

import { describe, expect, it } from 'vitest';
import { applyCommand, createInputState } from '../packages/gas/src/core/index.js';
import type {
  CapabilitiesTable,
  InputState,
  Timeline
} from '../packages/gas/src/protocol/index.js';
import { createRenderer, type Renderer } from '../packages/gas/src/renderer/index.js';
import { DEFAULT_LYRIA_RT_CONFIG, LYRIA_RT_CAPABILITIES } from '../packages/lyria-rt/src/index.js';
import { createLyriaRtConnectorWithDependencies } from '../packages/lyria-rt/src/connector.js';
import type {
  LyriaRtMusicGenerationConfig,
  LyriaRtMusicSession,
  LyriaRtSdkClient
} from '../packages/lyria-rt/src/transport.js';
import { MAGENTA_RT2_CAPABILITIES } from '../packages/magenta-rt2/src/index.js';
import { createMagentaRt2ConnectorWithDependencies } from '../packages/magenta-rt2/src/connector.js';
import { FakeBridge } from '../packages/magenta-rt2/test/support/fake-bridge.js';
import { flushAsync } from './support/deferred.js';
import { testTimeline } from './support/timeline.js';
import { VirtualClock } from './support/virtual-clock.js';

// No authored tempo, so the renderer's default of 120 BPM is the run's tempo.
const timeline: Timeline = testTimeline({ musicalContext: undefined });

function applyLive(
  state: InputState,
  command: Parameters<typeof applyCommand>[1],
  capabilities: CapabilitiesTable
): InputState {
  const result = applyCommand(state, command, { capabilities });
  if (!result.ok) throw new Error(result.failure.message);
  return result.state;
}

function loadWithOverride(renderer: Renderer, capabilities: CapabilitiesTable): InputState {
  const slow = applyLive(createInputState(timeline), { kind: 'setTempo', bpm: 90 }, capabilities);
  renderer.load(timeline, slow);
  return slow;
}

describe('connectors return to the run defaults when an initial override is cleared', () => {
  it('Lyria RealTime sends the default tempo again', async () => {
    const clock = new VirtualClock();
    const configs: LyriaRtMusicGenerationConfig[] = [];
    let ready: (() => void) | undefined;
    const client: LyriaRtSdkClient = {
      connect: ({ callbacks }) =>
        new Promise<LyriaRtMusicSession>((resolve) => {
          const session: LyriaRtMusicSession = {
            setWeightedPrompts: async () => undefined,
            setMusicGenerationConfig: async ({ musicGenerationConfig }) => {
              configs.push(musicGenerationConfig);
            },
            play: () => undefined,
            pause: () => undefined,
            stop: () => undefined,
            resetContext: () => undefined,
            close: () => undefined
          };
          ready = () => {
            resolve(session);
            queueMicrotask(() => callbacks.onmessage({ setupComplete: {} }));
          };
        })
    };
    const connector = createLyriaRtConnectorWithDependencies(
      { apiKey: 'test-key' },
      { clock, setupTimeoutSeconds: 15, createClient: () => client }
    );
    const renderer = createRenderer({
      clock,
      connector,
      connectorConfig: {
        prompt: { ...DEFAULT_LYRIA_RT_CONFIG.prompt, transitionDurationMs: 0, transitionSteps: 1 }
      }
    });
    const slow = loadWithOverride(renderer, LYRIA_RT_CAPABILITIES);
    const playing = renderer.play();
    await flushAsync();
    ready!();
    await playing;
    expect(configs.at(-1)?.bpm).toBe(90);

    await renderer.update(applyLive(slow, { kind: 'clearTempo' }, LYRIA_RT_CAPABILITIES));
    await flushAsync();
    expect(configs.at(-1)?.bpm).toBe(120);
    renderer.close();
  });

  it('Magenta RT2 states the default tempo again', async () => {
    const clock = new VirtualClock();
    const bridge = new FakeBridge();
    bridge.autoAnswer = true;
    const connector = createMagentaRt2ConnectorWithDependencies(
      { endpoint: 'ws://127.0.0.1:8765' },
      { clock, createSocket: bridge.createSocket }
    );
    const renderer = createRenderer({ clock, connector });
    const slow = loadWithOverride(renderer, MAGENTA_RT2_CAPABILITIES);
    const playing = renderer.play();
    await flushAsync();
    await playing;
    const globalPrompt = () => {
      const prompts = bridge.last.commands().at(-1)?.prompts as { text: string }[] | undefined;
      return prompts?.[0]?.text;
    };
    expect(globalPrompt()).toContain('90 BPM');

    await renderer.update(applyLive(slow, { kind: 'clearTempo' }, MAGENTA_RT2_CAPABILITIES));
    await flushAsync();
    expect(globalPrompt()).toContain('120 BPM');
    renderer.close();
  });
});
