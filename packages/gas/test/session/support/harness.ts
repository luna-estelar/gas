// A session on a virtual clock and a fake connector, with every event recorded.
// Documents are 120 BPM 4/4, so a bar lasts 2 s and bar n starts (n - 1) * 2 s
// after bar 1.
import { createSession, type GasOperationError } from '../../../src/api/index.js';
import type {
  AudioChunk,
  DocumentDefaults,
  GenerationPositionEvent,
  SessionState,
  WarningEvent
} from '../../../src/protocol/index.js';
import {
  FakeConnector,
  type FakeConnectorOptions
} from '../../../../../test/support/fake-connection.js';
import { flushAsync } from '../../../../../test/support/deferred.js';
import { VirtualClock } from '../../../../../test/support/virtual-clock.js';

export const SECONDS_PER_BAR = 2;

/** The clock time of `bar` when bar 1 started at `barOne`. */
export function barTime(bar: number, barOne = 0): number {
  return barOne + (bar - 1) * SECONDS_PER_BAR;
}

function document(lengthBars: number, bars: string): string {
  return `tempo 120
time_signature 4/4
length bars ${lengthBars}

track pad "Warm pad"

section main:
    length bars ${lengthBars}
${bars}
main()
`;
}

/** A track plays from bar 1 to the end of bar 4. */
export const PLAYS_AT_ONCE = document(4, '    bar 1:\n        pad.play\n');

/** Like `PLAYS_AT_ONCE`, but it loops, so it never finishes on its own. */
export const LOOPS = PLAYS_AT_ONCE.replace('length bars 4\n\ntrack', 'length bars 4 loop\n\ntrack');

/** Bars 1 to 8 rest (16 s); the track comes in at bar 9. */
export const OPENING_REST = document(12, '    bar 9:\n        pad.play\n');

/** Bars 1 to 2 play, bars 3 to 10 rest (16 s), bar 11 plays again. */
export const MIDDLE_REST = document(
  14,
  '    bar 1:\n        pad.play\n    bar 3:\n        pad.stop\n    bar 11:\n        pad.play\n'
);

/** No track ever plays unless the app starts one. */
export const NO_PLAYS = document(12, '    bar 1:\n        pad.flavor "still"\n');

/** Leaves tempo, time signature and key to `documentDefaults`. */
export const NO_TIMING = `length bars 4

track pad "Warm pad"

section main:
    length bars 4
    bar 1:
        pad.play

main()
`;

export const PAD = 'track.pad';

export interface HarnessOptions {
  readonly connector?: FakeConnectorOptions;
  readonly documentDefaults?: DocumentDefaults;
  /** Loaded before the harness returns, `LOOPS` by default. `null` loads nothing. */
  readonly source?: string | null;
}

export async function harness(options: HarnessOptions = {}) {
  const clock = new VirtualClock();
  const connector = new FakeConnector(options.connector);
  const session = await createSession({
    connector,
    clock,
    ...(options.documentDefaults !== undefined
      ? { documentDefaults: options.documentDefaults }
      : {})
  });
  const states: SessionState[] = [];
  const audio: AudioChunk[] = [];
  const errors: GasOperationError[] = [];
  const warnings: WarningEvent[] = [];
  const positions: GenerationPositionEvent[] = [];
  session.on('state', (state: SessionState) => states.push(state));
  session.on('audio', (chunk: AudioChunk) => audio.push(chunk));
  session.on('error', (error: GasOperationError) => errors.push(error));
  session.on('warning', (warning: WarningEvent) => warnings.push(warning));
  session.on('generationPosition', (position: GenerationPositionEvent) => positions.push(position));
  const source = options.source === undefined ? LOOPS : options.source;
  if (source !== null) await session.loadSource(source);

  /** Moves the clock and lets the session's promises settle. */
  async function advanceTo(time: number): Promise<void> {
    await flushAsync();
    clock.advanceTo(time);
    await flushAsync();
  }

  return {
    clock,
    connector,
    session,
    states,
    audio,
    errors,
    warnings,
    positions,
    advanceTo,
    statuses: () => states.map((state) => state.status)
  };
}

export type Harness = Awaited<ReturnType<typeof harness>>;

/** Plays and feeds audio from bar 1, so a track is sounding. */
export async function playing(options: HarnessOptions = {}): Promise<Harness> {
  const h = await harness(options);
  await h.session.play();
  h.connector.latest().pushAudio(2);
  await flushAsync();
  return h;
}

export function totalSeconds(chunks: readonly AudioChunk[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.durationSeconds, 0);
}

export function isSilent(chunk: AudioChunk): boolean {
  return chunk.bytes.every((byte) => byte === 0);
}

/** Resolves with the rejection, or fails the test if the promise resolves. */
export async function rejectionOf(promise: Promise<unknown>): Promise<GasOperationError> {
  try {
    await promise;
  } catch (error) {
    return error as GasOperationError;
  }
  throw new Error('Expected the call to reject.');
}
