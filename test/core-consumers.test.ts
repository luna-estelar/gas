// Exercise Core through the API session, renderer state derivation and compile-only inspection.
// Root tests may compose package surfaces; package boundary tests may not.

import { describe, expect, it } from 'vitest';
import { compileSource, type Timeline } from '../packages/language/src/index.js';
import { createSession, GasOperationError } from '../packages/api/src/index.js';
import { createRenderer } from '../packages/renderer/src/index.js';
import {
  applyCommand,
  applyCompletion,
  applyLoopBoundary,
  authoredEventSchedule,
  createInputState,
  effectiveStateAt,
  sectionInstanceAt,
  type EffectiveState
} from '../packages/core/src/index.js';
import { FakeConnector } from './support/fake-connector.js';
import { VirtualClock } from './support/virtual-clock.js';
import { readExample } from '../examples/support.js';

function corpusTimeline(name: string): Timeline {
  const result = compileSource(readExample(name), { name });
  if (!result.ok) {
    throw new Error(`Expected ${name}.gas to compile.`);
  }
  return result.timeline;
}

// Model-neutral capabilities fixture for consumer integration tests.
const CAPABILITIES = {
  intents: {
    flavor: 'supported',
    key: 'supported',
    tempo: 'supported',
    time_signature: 'supported',
    timbre: 'approximated',
    level: 'supported',
    notes: 'unsupported',
    motif: 'unsupported'
  }
} as const;

function trackOf(snapshot: EffectiveState, trackId: string) {
  const track = snapshot.tracks.find((entry) => entry.trackId === trackId);
  if (track === undefined) {
    throw new Error(`No track "${trackId}" in the snapshot.`);
  }
  return track;
}

// The API path runs through a real session and Renderer rather than a copy of
// the API's command mapping: a copy once declared live tracks as `pad` while the
// API declares `track.pad`, and the test passed while asserting behaviour the
// API did not have. Capability warnings come from the connector's `describe()`,
// whose table marks notes and motif unsupported.
async function apiSession(timeline: Timeline) {
  const clock = new VirtualClock();
  // Musical time starts with the first chunk, so a run needs audio to begin.
  const connector = new FakeConnector({ anchorOnStart: true });
  const session = await createSession({
    createRenderer: () => createRenderer({ clock, connector })
  });
  await session.loadTimeline(timeline);
  return { connector, session };
}

describe('consumer: the GAS API command path', () => {
  it('parses live statements, maps them onto canonical commands, and applies them', async () => {
    const { connector, session } = await apiSession(corpusTimeline('spec-example')); // authored guitar / drums / keys
    await session.play();

    const result = await session.submitLiveCommands(
      ['track pad "warm background"', 'pad.play', 'guitar.flavor "brighter"', 'tempo 120'].join(
        '\n'
      )
    );

    // All four landed, and none touched an unsupported intent.
    expect(result).toMatchObject({ ok: true, applied: 4, warnings: [] });
    // A host track joined the namespace under the compiler's id scheme.
    expect(session.getTracks()).toContainEqual({
      id: 'track.pad',
      name: 'pad',
      description: 'warm background',
      source: 'host'
    });

    // The Renderer forwarded the derived state, which reflects every command.
    const forwarded = connector.updates.at(-1)?.update.state;
    expect(forwarded).toBeDefined();
    expect(forwarded!.globals.tempo).toBe(120);
    expect(trackOf(forwarded!, 'track.pad').active).toBe(true);
    expect(trackOf(forwarded!, 'track.guitar').flavor).toEqual({ kind: 'text', text: 'brighter' });
    await session.close();
  });

  it('stages commands while stopped and warns from the capabilities table', async () => {
    const { connector, session } = await apiSession(corpusTimeline('spec-example'));

    const result = await session.submitLiveCommands('guitar.motif alda( c d e )');
    // Unsupported by the connector: the override is kept, but warned.
    expect(result).toMatchObject({ ok: true, applied: 1 });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: 'unsupported-intent',
      intent: 'motif',
      support: 'unsupported'
    });

    // Staged rather than dropped: the run starts with it.
    expect(connector.prepared).toEqual([]);
    await session.play();
    expect(trackOf(connector.prepared[0]!.state, 'track.guitar').motif).toBeDefined();
    await session.close();
  });

  it('surfaces an unknown live track name as a structured failure', async () => {
    const { session } = await apiSession(corpusTimeline('spec-example'));
    const rejection = session.submitLiveCommands('ghost.play');
    await expect(rejection).rejects.toBeInstanceOf(GasOperationError);
    await expect(rejection).rejects.toMatchObject({
      kind: 'live',
      failure: { code: 'unknown-track', trackId: 'ghost' }
    });
    await session.close();
  });
});

// --- Consumer 2: the Renderer derivation loop ---------------------------------

describe('consumer: the Renderer derivation loop', () => {
  it('derives at every schedule position and preserves live overrides across a loop', () => {
    const timeline = corpusTimeline('drum-loop'); // loop playback, one section
    const drumsId = timeline.tracks.find((track) => track.name === 'drums')!.trackId;

    // A live level override during the run.
    const applied = applyCommand(
      createInputState(timeline),
      { kind: 'setTrackLevel', trackId: drumsId, value: 0.7 },
      { phase: 'active', capabilities: CAPABILITIES }
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const state = applied.state;

    // The Renderer re-derives at each authored boundary, supplying the section
    // and the current loop iteration.
    const schedule = authoredEventSchedule(timeline);
    expect(schedule.length).toBeGreaterThan(0);
    for (const position of schedule) {
      const snapshot = effectiveStateAt(state, position, {
        loopIteration: 1,
        activeSection: sectionInstanceAt(timeline, position)
      });
      expect(snapshot.tracks).toHaveLength(timeline.tracks.length);
      expect(trackOf(snapshot, drumsId).level).toEqual({ kind: 'level', value: 0.7 });
    }

    // At the loop boundary the Renderer preserves live overrides; iteration 2
    // still sees the live level.
    const looped = applyLoopBoundary(state);
    expect(looped.live).toEqual(state.live);
    const iterationTwo = effectiveStateAt(looped, schedule[0], {
      loopIteration: 2,
      activeSection: sectionInstanceAt(timeline, schedule[0])
    });
    expect(trackOf(iterationTwo, drumsId).level).toEqual({ kind: 'level', value: 0.7 });

    // On completion the Renderer clears overrides; the authored document alone remains.
    const completed = applyCompletion(state);
    expect(completed.live).toEqual([]);
    expect(
      trackOf(
        effectiveStateAt(completed, schedule[0], {
          activeSection: sectionInstanceAt(timeline, schedule[0])
        }),
        drumsId
      ).level
    ).toBeUndefined();
  });
});

// --- Consumer 3: CLI / compile-only inspection --------------------------------

describe('consumer: CLI / compile-only inspection', () => {
  it('scrubs effective state across bars with no Renderer, connector, or capabilities table', () => {
    const timeline = corpusTimeline('arrangement');
    const state = createInputState(timeline);

    // Inspection needs no capabilities table — only applyCommand takes one.
    for (let bar = 1; bar <= timeline.arrangedBars; bar++) {
      const snapshot = effectiveStateAt(
        state,
        { bar },
        {
          activeSection: sectionInstanceAt(timeline, { bar })
        }
      );
      expect(snapshot.tracks).toHaveLength(timeline.tracks.length);
    }

    // A concrete arrangement fact: the bass enters at bar 9 (the peak section).
    const bassId = timeline.tracks.find((track) => track.name === 'bass')!.trackId;
    const activeAt = (bar: number) =>
      trackOf(
        effectiveStateAt(state, { bar }, { activeSection: sectionInstanceAt(timeline, { bar }) }),
        bassId
      ).active;
    expect(activeAt(8)).toBe(false);
    expect(activeAt(9)).toBe(true);
  });
});
