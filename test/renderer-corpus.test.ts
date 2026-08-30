// End-to-end: compiler output flows through Core derivation and the deterministic
// Renderer scheduler for every corpus document. Root tests may compose package
// surfaces; package boundary tests intentionally may not.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  createInputState,
  effectiveStateAt,
  sectionInstanceAt
} from '../packages/core/src/index.js';
import { compileSource } from '../packages/language/src/index.js';
import { createRenderer } from '../packages/renderer/src/index.js';
import type {
  CapabilitiesTable,
  RendererPositionEvent,
  RendererStatusEvent,
  Timeline
} from '../packages/protocol/src/index.js';
import { FakeConnector } from '../packages/renderer/test/support/fake-connector.js';
import { VirtualClock } from '../packages/renderer/test/support/virtual-clock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusRoot = path.resolve(here, '../packages/language/test/corpus');
const corpusFiles = readdirSync(corpusRoot)
  .filter((entry) => entry.endsWith('.gas'))
  .sort();
if (corpusFiles.length === 0) {
  throw new Error(`No .gas corpus documents found in ${corpusRoot}.`);
}

describe('renderer executes every compiled corpus timeline', () => {
  test.each(corpusFiles)(
    '%s renders deterministically from Core-derived boundaries',
    async (file) => {
      const source = readFileSync(path.join(corpusRoot, file), 'utf8');
      const result = compileSource(source, { name: file });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const first = await renderScript(result.timeline);
      const second = await renderScript(result.timeline);
      expect(first.log).toEqual(second.log);
      expect(first.connector.prepared).toHaveLength(1);
      expect(first.connector.calls.filter((call) => call === 'start')).toHaveLength(1);

      const input = createInputState(result.timeline);
      for (const { update, requested } of first.connector.updates) {
        expect(update.state).toEqual(
          effectiveStateAt(input, requested, {
            loopIteration: 0,
            activeSection: sectionInstanceAt(result.timeline, requested)
          })
        );
      }
    }
  );
});

async function renderScript(timeline: Timeline): Promise<{
  connector: FakeConnector;
  log: readonly string[];
}> {
  const clock = new VirtualClock();
  const connector = new FakeConnector({
    description: { capabilities: allSupportedCapabilities() }
  });
  const renderer = await createRenderer({
    clock,
    connector,
    runIdFactory: () => 'corpus-run'
  });
  const statuses: RendererStatusEvent[] = [];
  const positions: RendererPositionEvent[] = [];
  renderer.on('status', (event) => statuses.push(event));
  renderer.on('position', (event) => positions.push(event));
  await renderer.load(timeline, createInputState(timeline));
  await renderer.start();

  if (timeline.playback.mode === 'finite') {
    await drainClock(clock, () => statuses.at(-1)?.playback === 'stopped');
  } else if (timeline.playback.mode === 'loop') {
    await drainClock(clock, () =>
      positions.some((event) => event.loopIteration === 2 && event.position.bar === 1)
    );
    await renderer.stop();
  } else {
    await drainClock(clock, () => statuses.at(-1)?.playback === 'holding');
    await renderer.stop();
  }

  const eventLog = [
    ...statuses.map(
      (event) =>
        `status:${event.lifecycle}:${event.playback}:${event.runId ?? '-'}:${event.throttled ?? false}`
    ),
    ...positions.map(
      (event) =>
        `position:${event.position.bar}:${event.seconds}:${event.loopIteration}:${event.runId}`
    )
  ];
  const updateLog = connector.updates.map(({ update, requested }) =>
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
  return { connector, log: [...connector.calls, ...eventLog, ...updateLog] };
}

async function drainClock(clock: VirtualClock, complete: () => boolean): Promise<void> {
  for (let step = 0; step < 500; step += 1) {
    await flushAsync();
    if (complete()) return;
    const deadline = clock.pendingDeadlines()[0];
    if (deadline === undefined) break;
    clock.advanceTo(deadline);
  }
  throw new Error('Renderer corpus script did not reach its terminal checkpoint.');
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

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
