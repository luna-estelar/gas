// Each real connector behind the real renderer, falling back to the run's
// defaults once a live override is cleared. Starting with the override in place
// is the case that matters: the connector must not mistake the initial effective
// tempo for the default it returns to.

import { describe, expect, it } from 'vitest';
import { applyCommand, createInputState } from '../packages/gas/src/core/index.js';
import type {
  CapabilitiesTable,
  Connector,
  InputState,
  Renderer,
  Timeline
} from '../packages/gas/src/protocol/index.js';
import { createRenderer } from '../packages/gas/src/renderer/index.js';
import { DEFAULT_LYRIA_RT_CONFIG, LYRIA_RT_CAPABILITIES } from '../packages/lyria-rt/src/index.js';
import {
  createLyriaRtConnectorWithDependencies,
  type LyriaRtMusicGenerationConfig,
  type LyriaRtMusicSession,
  type LyriaRtSdkClient
} from '../packages/lyria-rt/src/connector.js';
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
  const result = applyCommand(state, command, { phase: 'active', capabilities });
  if (!result.ok) throw new Error(result.failure.message);
  return result.state;
}

async function loadWithOverride(
  renderer: Renderer,
  capabilities: CapabilitiesTable
): Promise<InputState> {
  const slow = applyLive(createInputState(timeline), { kind: 'setTempo', bpm: 90 }, capabilities);
  await renderer.load(timeline, slow);
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
    const connector = createLyriaRtConnectorWithDependencies({
      clock,
      setupTimeoutSeconds: 15,
      createClient: () => client
    });
    const renderer = await createRenderer({
      clock,
      connector,
      settings: { apiKey: 'test-key' },
      runIdFactory: () => 'run-1'
    });
    await renderer.updateConnectorConfig({
      prompt: { ...DEFAULT_LYRIA_RT_CONFIG.prompt, transitionDurationMs: 0, transitionSteps: 1 }
    });
    const slow = await loadWithOverride(renderer, LYRIA_RT_CAPABILITIES);
    const started = renderer.start();
    await flushAsync();
    ready!();
    await started;
    expect(configs.at(-1)?.bpm).toBe(90);

    await renderer.updateState(applyLive(slow, { kind: 'clearTempo' }, LYRIA_RT_CAPABILITIES));
    await flushAsync();
    expect(configs.at(-1)?.bpm).toBe(120);
    await renderer.close();
  });
});
