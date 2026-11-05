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
import {
  OPENING_REST,
  SHORT_REST,
  PAD,
  isSilent,
  totalSeconds
} from '../packages/gas/test/api/session/support/harness.js';

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

/** A Lyria session with deterministic provider audio, including its cold delay. */
async function restHarness(
  source: string,
  options: { immediate?: boolean; coldDelay?: number } = {}
) {
  const clock = new VirtualClock();
  const sdk = new FakeLiveMusic();
  const connector = createLyriaRtConnectorWithDependencies(
    { apiKey: 'test-key' },
    { clock, setupTimeoutSeconds: 15, createClient: sdk.createClient }
  );
  const session = await createSession({ connector, clock });
  if (options.immediate) {
    await session.updateConnectorConfig({
      prompt: { transitionDurationMs: 0, transitionSteps: 1 }
    });
  }
  const audio: Array<{
    at: number;
    chunk: import('../packages/gas/src/protocol/index.js').AudioChunk;
  }> = [];
  const positions: number[] = [];
  const errors: unknown[] = [];
  session.on('audio', (chunk) => audio.push({ at: clock.now(), chunk }));
  session.on('generationPosition', (event) => positions.push(event.position.bar));
  session.on('error', (error) => errors.push(error));
  await session.loadSource(source);
  const play = session.play();
  await flushAsync(50);
  sdk.last.open();
  await flushAsync(50);
  const socket = sdk.last;
  if (options.coldDelay !== undefined) {
    const play = socket.session.play;
    let plays = 0;
    socket.session.play = () => {
      play();
      const delay = plays++ === 0 ? options.coldDelay! : 0.85;
      clock.schedule(clock.now() + delay, () => socket.audio(new Array(CHUNK_BYTES).fill(1)));
    };
  }
  sdk.last.setupComplete();
  await play;
  async function advanceTo(time: number) {
    await flushAsync(50);
    clock.advanceTo(time);
    await flushAsync(50);
  }
  return { session, clock, sdk, socket, audio, positions, errors, advanceTo };
}

describe('Lyria entry preparation', () => {
  it('preserves active prompts when an app edits a track during the resume lead', async () => {
    const h = await restHarness(MIDDLE_REST, { immediate: true });
    h.socket.audio(new Array(CHUNK_BYTES).fill(1), new Array(CHUNK_BYTES).fill(1));
    await h.advanceTo(barTime(3));
    await h.advanceTo(barTime(11) - RESUME_LEAD_SECONDS);
    expect(h.socket.kinds().at(-1)).toBe('play');
    await h.advanceTo(barTime(11) - RESUME_LEAD_SECONDS + 0.1);
    await h.session.setTrackTimbre(PAD, 'glass');
    await h.advanceTo(barTime(11) - 1);
    expect(h.socket.kinds().at(-1)).toBe('prompts');
    h.socket.audio(new Array(CHUNK_BYTES).fill(1));
    await h.advanceTo(barTime(11));
    expect(h.errors).toEqual([]);
    await h.session.close();
  });

  it.each([false, true])(
    'keeps generating through a short rest (immediate transition: %s)',
    async (immediate) => {
      const h = await restHarness(SHORT_REST, { immediate });
      h.socket.audio(new Array(CHUNK_BYTES).fill(1), new Array(CHUNK_BYTES).fill(1));
      for (const time of [0.75, 1.5, 2, 2.75, 3.5, 4, 4.8]) await h.advanceTo(time);
      expect(h.socket.kinds()).not.toContain('pause');
      h.socket.audio(new Array(CHUNK_BYTES).fill(1));
      await h.advanceTo(barTime(5));
      const chunks = h.audio.map((event) => event.chunk);
      const rest = chunks.findIndex(isSilent);
      const entry = chunks.findIndex((chunk, index) => index >= rest && !isSilent(chunk));
      expect(totalSeconds(chunks.slice(0, entry))).toBeCloseTo(barTime(5), 6);
      expect(h.errors).toEqual([]);
      await h.session.close();
    }
  );

  it.each([3.3, 5.3])(
    'budgets the cold first play of a long opening rest (%s s)',
    async (coldDelay) => {
      const h = await restHarness(OPENING_REST, { immediate: true, coldDelay });
      const coldLead =
        chunkDurationSeconds + LYRIA_RT_DESCRIPTION.model.initialStartupDelaySeconds!;
      await h.advanceTo(barTime(9) - coldLead);
      expect(h.socket.kinds().at(-1)).toBe('play');
      await h.advanceTo(barTime(9) - coldLead + coldDelay);
      await h.advanceTo(barTime(9) - chunkDurationSeconds);
      const first = h.audio.find((event) => !isSilent(event.chunk));
      expect(first?.at).toBeLessThanOrEqual(barTime(9) - chunkDurationSeconds);
      const index = h.audio.indexOf(first!);
      expect(totalSeconds(h.audio.slice(0, index).map((event) => event.chunk))).toBeCloseTo(
        barTime(9),
        6
      );
      expect(h.errors).toEqual([]);
      await h.session.close();
    }
  );

  const shortOpening = OPENING_REST.replace('    bar 9:', '    bar 3:');
  it('fails a cold preparation that never receives audio', async () => {
    const h = await restHarness(shortOpening, { immediate: true });
    await h.advanceTo(6);
    expect(h.errors).toHaveLength(1);
    expect(h.session.getState().status).toBe('stopped');
    expect(h.socket.released).toBe(true);
    await h.session.close();
  });

  it('prepares a short opening rest before starting its clock, retaining its full silence', async () => {
    const h = await restHarness(shortOpening, { immediate: true, coldDelay: 5.3 });
    expect(h.positions).toEqual([]);
    expect(h.socket.kinds().at(-1)).toBe('play');
    await h.advanceTo(5.3);
    expect(h.positions[0]).toBe(1);
    await h.advanceTo(5.3 + barTime(3) - chunkDurationSeconds);
    const first = h.audio.findIndex((event) => !isSilent(event.chunk));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(totalSeconds(h.audio.slice(0, first).map((event) => event.chunk))).toBeCloseTo(
      barTime(3),
      6
    );
    expect(h.socket.kinds()).not.toContain('pause');
    expect(h.errors).toEqual([]);
    await h.session.close();
  });

  it('cancels cold preparation when the app stops the pending entry', async () => {
    const h = await restHarness(shortOpening, { immediate: true });
    await h.session.stopTrack(PAD);
    expect(h.positions[0]).toBe(1);
    await h.advanceTo(10);
    expect(h.errors).toEqual([]);
    expect(h.session.getState().status).toBe('playing');
    await h.session.close();
  });

  it('drops late cold audio after Stop and opens a new socket on the next Play', async () => {
    const h = await restHarness(shortOpening, { immediate: true, coldDelay: 5.3 });
    await h.session.stop();
    await h.advanceTo(5.3);
    expect(h.positions).toEqual([]);
    expect(h.audio).toEqual([]);
    const play = h.session.play();
    await flushAsync(50);
    expect(h.sdk.connections).toHaveLength(2);
    h.sdk.last.open();
    await flushAsync(50);
    h.sdk.last.setupComplete();
    await play;
    expect(h.sdk.last.kinds()).toContain('play');
    await h.session.close();
  });
});
