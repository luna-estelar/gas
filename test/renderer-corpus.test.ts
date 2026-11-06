// Every corpus document compiles, derives state in Core and schedules in the session's renderer.

import { describe, expect, test } from 'vitest';
import {
  createInputState,
  effectiveStateAt,
  sectionInstanceAt
} from '../packages/gas/src/core/index.js';
import { compileSource } from '../packages/gas/src/language/index.js';
import { createRenderer, type RendererEnd } from '../packages/gas/src/renderer/index.js';
import type {
  AudioChunk,
  CapabilitiesTable,
  GenerationPositionEvent,
  Timeline
} from '../packages/gas/src/protocol/index.js';
import { FakeConnector, type FakeConnection } from './support/fake-connection.js';
import { VirtualClock } from './support/virtual-clock.js';
import { exampleFiles, readExample } from '../examples/support.js';
import { flushAsync } from './support/deferred.js';

const corpusFiles = exampleFiles();

// The clock moves at most this far per step, and the fake model sends this much
// audio per step while it isn't paused, so it keeps pace without a backlog.
const STEP_SECONDS = 1;
// Audio sent as soon as the connection opens, so bar 1 can start.
const LEAD_SECONDS = 2;

describe('renderer executes every compiled corpus timeline', () => {
  test.each(corpusFiles)(
    '%s renders deterministically from Core-derived boundaries',
    async (file) => {
      const source = readExample(file);
      const result = compileSource(source, { name: file });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const first = await renderScript(result.timeline);
      const second = await renderScript(result.timeline);
      expect(first.log).toEqual(second.log);
      expect(first.connector.connects).toHaveLength(1);
      expect(first.connector.connections).toHaveLength(1);
      expect(first.ended.filter((end) => end.reason === 'failed')).toEqual([]);

      const input = createInputState(result.timeline);
      for (const { update, requested } of first.connector.latest().updates) {
        expect(update.state).toEqual(
          effectiveStateAt(input, requested, {
            loopIteration: 1,
            activeSection: sectionInstanceAt(result.timeline, requested)
          })
        );
      }
    }
  );
});

async function renderScript(timeline: Timeline): Promise<{
  connector: FakeConnector;
  ended: readonly RendererEnd[];
  log: readonly string[];
}> {
  const clock = new VirtualClock();
  const connector = new FakeConnector({
    description: { capabilities: allSupportedCapabilities() }
  });
  const renderer = createRenderer({ clock, connector });
  const positions: GenerationPositionEvent[] = [];
  const audio: AudioChunk[] = [];
  const ended: RendererEnd[] = [];
  const warnings: string[] = [];
  renderer.on('generationPosition', (event) => positions.push(event));
  renderer.on('audio', (chunk) => audio.push(chunk));
  renderer.on('ended', (end) => ended.push(end));
  renderer.on('warning', (warning) => warnings.push(warning.code));
  renderer.load(timeline, createInputState(timeline));
  await renderer.play();
  const connection = connector.latest();
  feed(connection, LEAD_SECONDS);

  if (timeline.playback.mode === 'finite') {
    await drainClock(clock, connection, () => ended.length > 0);
  } else if (timeline.playback.mode === 'loop') {
    await drainClock(clock, connection, () =>
      positions.some((event) => event.loopIteration === 2 && event.position.bar === 1)
    );
    renderer.stop();
  } else {
    // An infinite document holds after its last arranged bar.
    const holding = Math.max(1, timeline.arrangedBars + 1);
    await drainClock(clock, connection, () =>
      positions.some((event) => event.position.bar === holding)
    );
    renderer.stop();
  }
  await flushAsync();

  const eventLog = [
    ...positions.map(
      (event) => `position:${event.position.bar}:${event.seconds}:${event.loopIteration}`
    ),
    ...audio.map(
      (chunk) =>
        `audio:${chunk.sequence}:${chunk.durationSeconds}:${chunk.bytes.every((byte) => byte === 0)}`
    ),
    ...ended.map((end) => `ended:${end.reason}`),
    ...warnings.map((code) => `warning:${code}`)
  ];
  const updateLog = connection.updates.map(({ update, requested }) =>
    JSON.stringify({
      requested,
      state: update.state,
      notation: update.notation?.map((value) => ({
        trackId: value.trackId,
        intent: value.intent,
        source: value.source,
        midiBytes: value.midi?.length
      }))
    })
  );
  return { connector, ended, log: [...connection.calls, ...eventLog, ...updateLog] };
}

/** Sends audio unless the renderer has paused the connection for a rest or a backlog. */
function feed(connection: FakeConnection, seconds: number): void {
  if (connection.closed || connection.flow.at(-1) === 'pause') return;
  connection.pushAudio(seconds);
}

async function drainClock(
  clock: VirtualClock,
  connection: FakeConnection,
  complete: () => boolean
): Promise<void> {
  for (let step = 0; step < 5000; step += 1) {
    await flushAsync();
    if (complete()) return;
    const deadline = clock.pendingDeadlines()[0];
    if (deadline === undefined) break;
    const next = Math.min(deadline, clock.now() + STEP_SECONDS);
    const elapsed = next - clock.now();
    clock.advanceTo(next);
    await flushAsync();
    feed(connection, elapsed);
  }
  throw new Error('The corpus script did not reach its terminal checkpoint.');
}

function allSupportedCapabilities(): CapabilitiesTable {
  return {
    intents: {
      flavor: 'supported',
      key: 'supported',
      tempo: 'supported',
      time_signature: 'supported',
      timbre: 'supported',
      level: 'supported',
      notes: 'supported',
      motif: 'supported'
    }
  };
}
