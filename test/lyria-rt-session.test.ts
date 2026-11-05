// Lyria RealTime behind a real session, over a fake SDK. The session pauses the
// model for a rest and resumes it one lead before the next track, then sends
// the entry's prompts. Lyria must play from then on, not wait for the entry.
import { describe, expect, it } from 'vitest';
import { createSession, sourceText } from '../packages/gas/src/api/index.js';
import { DEFAULT_LYRIA_RT_CONFIG, LYRIA_RT_DESCRIPTION } from '../packages/lyria-rt/src/index.js';
import { createLyriaRtConnectorWithDependencies } from '../packages/lyria-rt/src/connector.js';
import { FakeLiveMusic } from '../packages/lyria-rt/test/support/fake-sdk.js';
import { flushAsync } from './support/deferred.js';
import { VirtualClock } from './support/virtual-clock.js';

// One chunk of lookahead plus Lyria's reported start-up delay.
const { chunkDurationSeconds, startupDelaySeconds } = LYRIA_RT_DESCRIPTION.model;
const RESUME_LEAD_SECONDS = chunkDurationSeconds + startupDelaySeconds!;

const SECONDS_PER_BAR = 2;
const CHUNK_BYTES = 2 * 192_000;

/** pad plays bars 1-2, rests bars 3-10, and comes back at bar 11. */
const MIDDLE_REST = `tempo 120
time_signature 4/4
length bars 14

track pad "Warm pad"

section main:
    length bars 14
    bar 1:
        pad.play
    bar 3:
        pad.stop
    bar 11:
        pad.play

main()
`;

function barTime(bar: number): number {
  return (bar - 1) * SECONDS_PER_BAR;
}

async function playing() {
  const clock = new VirtualClock();
  const sdk = new FakeLiveMusic();
  const connector = createLyriaRtConnectorWithDependencies(
    { apiKey: 'test-key' },
    { clock, setupTimeoutSeconds: 15, createClient: sdk.createClient }
  );
  const session = await createSession({ connector, clock });
  await session.updateConnectorConfig({
    prompt: { ...DEFAULT_LYRIA_RT_CONFIG.prompt, transitionDurationMs: 0, transitionSteps: 1 }
  });
  const errors: unknown[] = [];
  session.on('error', (error) => errors.push(error));
  await session.loadSource(sourceText(MIDDLE_REST, 'middle-rest.gas'));

  const play = session.play();
  await flushAsync(50);
  sdk.last.open();
  await flushAsync(50);
  sdk.last.setupComplete();
  await play;
  // Two bars of audio, so bar 1 anchors at time 0 and the pad is fed up to the rest.
  sdk.last.audio(new Array(CHUNK_BYTES).fill(0), new Array(CHUNK_BYTES).fill(0));
  await flushAsync(50);

  async function advanceTo(time: number): Promise<void> {
    await flushAsync(50);
    clock.advanceTo(time);
    await flushAsync(50);
  }
  return { session, sdk, errors, advanceTo };
}

describe('Lyria RealTime through a rest', () => {
  it('pauses at the rest, and plays again with prompts one lead before the entry', async () => {
    const { session, sdk, errors, advanceTo } = await playing();
    const socket = sdk.last;
    expect(socket.kinds()).toEqual(['config', 'prompts', 'play']);

    await advanceTo(barTime(3));
    expect(socket.kinds().slice(3)).toEqual(['pause']);

    await advanceTo(barTime(11) - RESUME_LEAD_SECONDS);
    expect(socket.kinds().slice(4)).toEqual(['prompts', 'play']);

    // Audio from the entry keeps the track going without a missing-audio failure.
    socket.audio(new Array(CHUNK_BYTES).fill(0), new Array(CHUNK_BYTES).fill(0));
    await advanceTo(barTime(12));
    expect(errors).toEqual([]);
    expect(session.getState().status).toBe('playing');
    await session.stop();
  });

  it('opens a fresh socket for each Play', async () => {
    const { session, sdk } = await playing();
    const first = sdk.last;
    await session.stop();
    await flushAsync(50);
    expect(first.released).toBe(true);

    const play = session.play();
    await flushAsync(50);
    expect(sdk.connections).toHaveLength(2);
    sdk.last.open();
    await flushAsync(50);
    sdk.last.setupComplete();
    await play;
    expect(sdk.last.kinds()).toEqual(['config', 'prompts', 'play']);
    await session.close();
  });
});
