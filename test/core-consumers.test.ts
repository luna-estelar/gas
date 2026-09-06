// Exercise Core through API commands, renderer state derivation and compile-only inspection.

import { describe, expect, it } from 'vitest';
import {
  compileSource,
  parseLiveCommands,
  type LiveStatement,
  type Timeline
} from '../packages/language/src/index.js';
import {
  applyCommand,
  applyCompletion,
  applyLoopBoundary,
  authoredEventSchedule,
  createInputState,
  effectiveStateAt,
  sectionInstanceAt,
  type Command,
  type CommandWarning,
  type EffectiveState,
  type InputState,
  type PlaybackPhase
} from '../packages/core/src/index.js';
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

// Reference mapping from live statements to Core commands. Unknown track names
// reach Core validation as unresolved references.
function trackResolver(state: InputState): (name: string) => string {
  const byName = new Map<string, string>();
  for (const track of state.timeline.tracks) {
    byName.set(track.name, track.trackId);
    byName.set(track.trackId, track.trackId);
  }
  for (const host of state.hostTracks) {
    byName.set(host.name ?? host.id, host.id);
    byName.set(host.id, host.id);
  }
  return (name) => byName.get(name) ?? name;
}

function toCommand(statement: LiveStatement, resolve: (name: string) => string): Command {
  switch (statement.kind) {
    case 'DeclareTrack':
      return {
        kind: 'defineTrack',
        id: statement.name,
        name: statement.name,
        description: statement.description
      };
    case 'Tempo':
      return { kind: 'setTempo', bpm: statement.bpm };
    case 'Play':
      return { kind: 'playTrack', trackId: resolve(statement.trackName) };
    case 'Stop':
      return { kind: 'stopTrack', trackId: resolve(statement.trackName) };
    case 'Flavor':
      return {
        kind: 'setTrackFlavor',
        trackId: resolve(statement.trackName),
        value: statement.value
      };
    case 'Timbre':
      return {
        kind: 'setTrackTimbre',
        trackId: resolve(statement.trackName),
        value: statement.value.value
      };
    case 'Level':
      return {
        kind: 'setTrackLevel',
        trackId: resolve(statement.trackName),
        value: statement.value
      };
    case 'Notes':
      return {
        kind: 'setTrackNotes',
        trackId: resolve(statement.trackName),
        alda: statement.value.raw
      };
    case 'Motif':
      return {
        kind: 'setTrackMotif',
        trackId: resolve(statement.trackName),
        alda: statement.value.raw
      };
  }
}

// Applies a live fragment as the API would: parse, map each statement, apply in
// order at the given phase, collecting warnings.
function submitLive(
  state: InputState,
  source: string,
  phase: PlaybackPhase
): { state: InputState; warnings: CommandWarning[] } {
  const parsed = parseLiveCommands(source);
  if (!parsed.ok) {
    throw new Error(
      `Live fragment failed to parse: ${parsed.diagnostics.map((d) => d.message).join('; ')}`
    );
  }
  let next = state;
  const warnings: CommandWarning[] = [];
  for (const statement of parsed.statements) {
    const command = toCommand(statement, trackResolver(next));
    const result = applyCommand(next, command, { phase, capabilities: CAPABILITIES });
    if (!result.ok) {
      throw new Error(`Command rejected: ${result.failure.message}`);
    }
    next = result.state;
    warnings.push(...result.warnings);
  }
  return { state: next, warnings };
}

describe('consumer: the GAS API command path', () => {
  it('parses live statements, maps them onto canonical commands, and applies them', () => {
    const timeline = corpusTimeline('spec-example'); // authored guitar / drums / keys
    const loaded = createInputState(timeline);

    const { state, warnings } = submitLive(
      loaded,
      ['track pad "warm background"', 'pad.play', 'guitar.flavor "brighter"', 'tempo 120'].join(
        '\n'
      ),
      'active'
    );

    // A host track joined the namespace; three overrides landed live, in order.
    expect(state.hostTracks).toEqual([{ id: 'pad', name: 'pad', description: 'warm background' }]);
    expect(state.live.map((override) => override.kind)).toEqual([
      'playTrack',
      'setTrackFlavor',
      'setTempo'
    ]);
    // The live statements had no unsupported intent here, so no warnings.
    expect(warnings).toEqual([]);

    // Deriving at bar 1 (the chorus is active) reflects the applied commands.
    const snapshot = effectiveStateAt(
      state,
      { bar: 1 },
      {
        activeSection: sectionInstanceAt(timeline, { bar: 1 })
      }
    );
    expect(snapshot.globals.tempo).toBe(120);
    expect(trackOf(snapshot, 'pad').active).toBe(true);
    const flavor = state.live.find((override) => override.kind === 'setTrackFlavor');
    expect(trackOf(snapshot, 'track.guitar').flavor).toEqual({
      kind: 'text',
      text: flavor && 'value' in flavor ? flavor.value : ''
    });
  });

  it('stages commands while stopped and warns from the capabilities table', () => {
    const loaded = createInputState(corpusTimeline('spec-example'));
    // notes/motif are unsupported in CAPABILITIES: the override is kept, but warned.
    const { state, warnings } = submitLive(loaded, 'guitar.motif alda( c d e )', 'stopped');
    expect(state.staged.map((override) => override.kind)).toEqual(['setTrackMotif']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'unsupported-intent',
      intent: 'motif',
      support: 'unsupported'
    });
  });

  it('surfaces an unknown live track name as a structured failure', () => {
    const loaded = createInputState(corpusTimeline('spec-example'));
    const parsed = parseLiveCommands('ghost.play');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const command = toCommand(parsed.statements[0], trackResolver(loaded));
    const result = applyCommand(loaded, command, { phase: 'active', capabilities: CAPABILITIES });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('unknown-track');
    expect(result.failure.trackId).toBe('ghost');
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
