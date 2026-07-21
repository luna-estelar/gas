import { describe, expect, it, test } from 'vitest';
import type { CapabilitiesTable, IntentKeyword, IntentSupport } from '@luna-estelar/gas-protocol';
import {
  applyCommand,
  createInputState,
  defineTrack,
  type Command,
  type CommandFailureCode,
  type InputState,
  type OverrideCommand,
  type PlaybackPhase
} from '../src/index.js';
import { validTimeline } from './support/timelines.js';

const INTENT_KEYWORDS: readonly IntentKeyword[] = [
  'flavor',
  'key',
  'tempo',
  'time_signature',
  'timbre',
  'level',
  'notes',
  'motif'
];

// Capabilities fixtures for command validation.
function uniform(support: IntentSupport): CapabilitiesTable {
  return {
    intents: Object.fromEntries(INTENT_KEYWORDS.map((intent) => [intent, support])) as Record<
      IntentKeyword,
      IntentSupport
    >
  };
}

const ALL_SUPPORTED = uniform('supported');
const ALL_UNSUPPORTED = uniform('unsupported');
const ALL_APPROXIMATED = uniform('approximated');

function baseState(): InputState {
  return createInputState(validTimeline());
}

function mustApply(
  state: InputState,
  command: Command,
  phase: PlaybackPhase,
  capabilities: CapabilitiesTable = ALL_SUPPORTED
): InputState {
  const result = applyCommand(state, command, { phase, capabilities });
  if (!result.ok) {
    throw new Error(`Expected the command to apply: ${result.failure.message}`);
  }
  return result.state;
}

// One valid fixture per override kind, against the fixture timeline's
// 'track.pad' / 'track.lead', with the intent keyword each command expresses
// (undefined for the structural play/stop commands).
const OVERRIDES: ReadonlyArray<
  readonly [name: string, command: OverrideCommand, intent: IntentKeyword | undefined]
> = [
  ['playTrack', { kind: 'playTrack', trackId: 'track.pad' }, undefined],
  ['stopTrack', { kind: 'stopTrack', trackId: 'track.pad' }, undefined],
  ['setGlobalFlavor', { kind: 'setGlobalFlavor', value: 'warm dusk' }, 'flavor'],
  ['clearGlobalFlavor', { kind: 'clearGlobalFlavor' }, 'flavor'],
  ['setGlobalLevel', { kind: 'setGlobalLevel', value: 0.7 }, undefined],
  ['clearGlobalLevel', { kind: 'clearGlobalLevel' }, undefined],
  ['setTrackFlavor', { kind: 'setTrackFlavor', trackId: 'track.pad', value: 'glassy' }, 'flavor'],
  ['clearTrackFlavor', { kind: 'clearTrackFlavor', trackId: 'track.pad' }, 'flavor'],
  [
    'setTrackTimbre',
    { kind: 'setTrackTimbre', trackId: 'track.pad', value: 'tape piano' },
    'timbre'
  ],
  ['clearTrackTimbre', { kind: 'clearTrackTimbre', trackId: 'track.pad' }, 'timbre'],
  ['setTrackLevel', { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.4 }, 'level'],
  ['clearTrackLevel', { kind: 'clearTrackLevel', trackId: 'track.pad' }, 'level'],
  ['setTrackNotes', { kind: 'setTrackNotes', trackId: 'track.pad', alda: 'c d e' }, 'notes'],
  ['setTrackMotif', { kind: 'setTrackMotif', trackId: 'track.pad', alda: 'c8 d e2' }, 'motif'],
  ['setTempo', { kind: 'setTempo', bpm: 96 }, 'tempo'],
  ['clearTempo', { kind: 'clearTempo' }, 'tempo']
];

const INTENT_COMMANDS = OVERRIDES.filter(([, , intent]) => intent !== undefined) as ReadonlyArray<
  readonly [name: string, command: OverrideCommand, intent: IntentKeyword]
>;

const PHASES: readonly PlaybackPhase[] = ['stopped', 'active'];

describe('applyCommand routes overrides by phase', () => {
  const ROUTING = PHASES.flatMap((phase) =>
    OVERRIDES.map(([name, command]) => [phase, name, command] as const)
  );

  test.each(ROUTING)(
    "applied while %s, %s becomes that phase's override",
    (phase, _name, command) => {
      const result = applyCommand(baseState(), command, { phase, capabilities: ALL_SUPPORTED });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [target, other] =
        phase === 'stopped'
          ? [result.state.staged, result.state.live]
          : [result.state.live, result.state.staged];
      expect(target).toEqual([command]);
      expect(other).toEqual([]);
      expect(result.state.hostTracks).toEqual([]);
      expect(result.warnings).toEqual([]);
    }
  );
});

describe('applyCommand applies defineTrack independent of phase', () => {
  test.each(PHASES)(
    'applied while %s, defineTrack appends a host track and no override',
    (phase) => {
      const result = applyCommand(
        baseState(),
        { kind: 'defineTrack', id: 'host.synth', name: 'Synth' },
        { phase, capabilities: ALL_UNSUPPORTED }
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.hostTracks).toEqual([{ id: 'host.synth', name: 'Synth' }]);
      expect(result.state.staged).toEqual([]);
      expect(result.state.live).toEqual([]);
      // Track identity is structural, not renderable intent — never warned about.
      expect(result.warnings).toEqual([]);
    }
  );

  it('fails a duplicate id exactly like the standalone defineTrack', () => {
    const command = { kind: 'defineTrack', id: 'track.pad' } as const;
    const viaApply = applyCommand(baseState(), command, {
      phase: 'stopped',
      capabilities: ALL_SUPPORTED
    });
    const standalone = defineTrack(baseState(), command);
    expect(viaApply.ok).toBe(false);
    expect(standalone.ok).toBe(false);
    if (viaApply.ok || standalone.ok) return;
    expect(viaApply.failure).toEqual(standalone.failure);
    expect(viaApply.failure.code).toBe('duplicate-track');
  });

  it('rejects a host track id already defined through applyCommand', () => {
    const state = mustApply(baseState(), { kind: 'defineTrack', id: 'host.a' }, 'stopped');
    const clash = applyCommand(
      state,
      { kind: 'defineTrack', id: 'host.a' },
      { phase: 'active', capabilities: ALL_SUPPORTED }
    );
    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.failure.code).toBe('duplicate-track');
  });
});

// Each case runs against a fresh state and must fail with the expected code,
// leaving the state untouched.
const REJECTIONS: ReadonlyArray<
  readonly [name: string, command: unknown, code: CommandFailureCode]
> = [
  ['playTrack on an unknown track', { kind: 'playTrack', trackId: 'track.ghost' }, 'unknown-track'],
  ['stopTrack on an unknown track', { kind: 'stopTrack', trackId: 'track.ghost' }, 'unknown-track'],
  [
    'setTrackFlavor on an unknown track',
    { kind: 'setTrackFlavor', trackId: 'track.ghost', value: 'x' },
    'unknown-track'
  ],
  [
    'clearTrackFlavor on an unknown track',
    { kind: 'clearTrackFlavor', trackId: 'track.ghost' },
    'unknown-track'
  ],
  [
    'setTrackTimbre on an unknown track',
    { kind: 'setTrackTimbre', trackId: 'track.ghost', value: 'x' },
    'unknown-track'
  ],
  [
    'clearTrackTimbre on an unknown track',
    { kind: 'clearTrackTimbre', trackId: 'track.ghost' },
    'unknown-track'
  ],
  [
    'setTrackLevel on an unknown track',
    { kind: 'setTrackLevel', trackId: 'track.ghost', value: 0.5 },
    'unknown-track'
  ],
  [
    'clearTrackLevel on an unknown track',
    { kind: 'clearTrackLevel', trackId: 'track.ghost' },
    'unknown-track'
  ],
  [
    'setTrackNotes on an unknown track',
    { kind: 'setTrackNotes', trackId: 'track.ghost', alda: 'c' },
    'unknown-track'
  ],
  [
    'setTrackMotif on an unknown track',
    { kind: 'setTrackMotif', trackId: 'track.ghost', alda: 'c' },
    'unknown-track'
  ],
  // The track is checked before the payload: a wrong address is the more useful failure.
  [
    'a bad level on an unknown track',
    { kind: 'setTrackLevel', trackId: 'track.ghost', value: 9 },
    'unknown-track'
  ],
  [
    'defineTrack with an authored track id',
    { kind: 'defineTrack', id: 'track.lead' },
    'duplicate-track'
  ],
  ['a global level below zero', { kind: 'setGlobalLevel', value: -0.1 }, 'invalid-level'],
  [
    'a track level above one',
    { kind: 'setTrackLevel', trackId: 'track.pad', value: 1.5 },
    'invalid-level'
  ],
  ['a NaN level', { kind: 'setGlobalLevel', value: Number.NaN }, 'invalid-level'],
  ['a text level', { kind: 'setTrackLevel', trackId: 'track.pad', value: '0.5' }, 'invalid-level'],
  ['a zero tempo', { kind: 'setTempo', bpm: 0 }, 'invalid-tempo'],
  ['a tempo below one bpm', { kind: 'setTempo', bpm: 0.9 }, 'invalid-tempo'],
  ['a NaN tempo', { kind: 'setTempo', bpm: Number.NaN }, 'invalid-tempo'],
  ['a text tempo', { kind: 'setTempo', bpm: '120' }, 'invalid-tempo'],
  ['a number flavor', { kind: 'setGlobalFlavor', value: 42 }, 'invalid-value'],
  ['a missing timbre value', { kind: 'setTrackTimbre', trackId: 'track.pad' }, 'invalid-value'],
  [
    'a number alda snippet',
    { kind: 'setTrackNotes', trackId: 'track.pad', alda: 7 },
    'invalid-value'
  ],
  ['a number track id', { kind: 'playTrack', trackId: 5 }, 'invalid-value'],
  ['an empty track id', { kind: 'stopTrack', trackId: '' }, 'invalid-value'],
  ['an empty defineTrack id', { kind: 'defineTrack', id: '' }, 'invalid-value'],
  ['an unrecognized command kind', { kind: 'warble' }, 'invalid-value'],
  ['a null command', null, 'invalid-value'],
  ['a missing command', undefined, 'invalid-value']
];

describe('applyCommand rejects invalid commands', () => {
  test.each(REJECTIONS)('rejects %s', (_name, command, code) => {
    const state = baseState();
    const result = applyCommand(state, command as Command, {
      phase: 'stopped',
      capabilities: ALL_SUPPORTED
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe(code);
    expect(result.failure.message.length).toBeGreaterThan(0);
    if (code === 'unknown-track') {
      expect(result.failure.trackId).toBe('track.ghost');
    }
    expect(state.staged).toEqual([]);
    expect(state.live).toEqual([]);
    expect(state.hostTracks).toEqual([]);
  });

  const ACCEPTED_BOUNDARIES: ReadonlyArray<readonly [name: string, command: Command]> = [
    ['a level of exactly 0', { kind: 'setGlobalLevel', value: 0 }],
    ['a level of exactly 1', { kind: 'setTrackLevel', trackId: 'track.pad', value: 1 }],
    ['a tempo of exactly 1 bpm', { kind: 'setTempo', bpm: 1 }],
    ['a fractional tempo', { kind: 'setTempo', bpm: 72.5 }],
    ['an empty flavor', { kind: 'setGlobalFlavor', value: '' }],
    ['an empty alda snippet', { kind: 'setTrackNotes', trackId: 'track.pad', alda: '' }]
  ];

  test.each(ACCEPTED_BOUNDARIES)('accepts %s', (_name, command) => {
    const result = applyCommand(baseState(), command, {
      phase: 'stopped',
      capabilities: ALL_SUPPORTED
    });
    expect(result.ok).toBe(true);
  });
});

describe('applyCommand warns from the capabilities table', () => {
  test.each(INTENT_COMMANDS)(
    '%s warns when its intent is unsupported',
    (_name, command, intent) => {
      const result = applyCommand(baseState(), command, {
        phase: 'active',
        capabilities: ALL_UNSUPPORTED
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toHaveLength(1);
      const warning = result.warnings[0];
      expect(warning.code).toBe('unsupported-intent');
      expect(warning.intent).toBe(intent);
      expect(warning.support).toBe('unsupported');
      expect(warning.message.length).toBeGreaterThan(0);
      if ('trackId' in command) {
        expect(warning.trackId).toBe(command.trackId);
      } else {
        expect(warning.trackId).toBeUndefined();
      }
      // Warn, never drop: the override is stored despite the warning.
      expect(result.state.live).toEqual([command]);
    }
  );

  test.each(INTENT_COMMANDS)('%s warns more softly when approximated', (_name, command, intent) => {
    const approximated = applyCommand(baseState(), command, {
      phase: 'active',
      capabilities: ALL_APPROXIMATED
    });
    const unsupported = applyCommand(baseState(), command, {
      phase: 'active',
      capabilities: ALL_UNSUPPORTED
    });
    expect(approximated.ok).toBe(true);
    expect(unsupported.ok).toBe(true);
    if (!approximated.ok || !unsupported.ok) return;
    expect(approximated.warnings).toHaveLength(1);
    expect(approximated.warnings[0].intent).toBe(intent);
    expect(approximated.warnings[0].support).toBe('approximated');
    expect(approximated.warnings[0].message).not.toBe(unsupported.warnings[0].message);
  });

  const STRUCTURAL: ReadonlyArray<readonly [name: string, command: Command]> = [
    ['playTrack', { kind: 'playTrack', trackId: 'track.pad' }],
    ['stopTrack', { kind: 'stopTrack', trackId: 'track.pad' }],
    ['defineTrack', { kind: 'defineTrack', id: 'host.synth' }]
  ];

  test.each(STRUCTURAL)(
    '%s never warns, even when every intent is unsupported',
    (_name, command) => {
      const result = applyCommand(baseState(), command, {
        phase: 'active',
        capabilities: ALL_UNSUPPORTED
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
    }
  );

  it('treats global level as Renderer-owned while track level still follows capabilities', () => {
    const global = applyCommand(
      baseState(),
      { kind: 'setGlobalLevel', value: 0.5 },
      { phase: 'active', capabilities: ALL_UNSUPPORTED }
    );
    const track = applyCommand(
      baseState(),
      { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.5 },
      { phase: 'active', capabilities: ALL_APPROXIMATED }
    );
    expect(global.ok).toBe(true);
    expect(track.ok).toBe(true);
    if (!global.ok || !track.ok) return;
    expect(global.warnings).toEqual([]);
    expect(track.warnings).toEqual([
      expect.objectContaining({ intent: 'level', support: 'approximated', trackId: 'track.pad' })
    ]);
  });

  it('warns on a clear exactly like the matching set', () => {
    const set = applyCommand(
      baseState(),
      { kind: 'setTrackTimbre', trackId: 'track.pad', value: 'tape' },
      { phase: 'active', capabilities: ALL_UNSUPPORTED }
    );
    const clear = applyCommand(
      baseState(),
      { kind: 'clearTrackTimbre', trackId: 'track.pad' },
      { phase: 'active', capabilities: ALL_UNSUPPORTED }
    );
    expect(set.ok).toBe(true);
    expect(clear.ok).toBe(true);
    if (!set.ok || !clear.ok) return;
    expect(clear.warnings).toEqual(set.warnings);
  });

  it('warns only about the intents the table marks', () => {
    const capabilities: CapabilitiesTable = {
      intents: { ...ALL_SUPPORTED.intents, tempo: 'unsupported' }
    };
    const warned = applyCommand(
      baseState(),
      { kind: 'setTempo', bpm: 90 },
      { phase: 'stopped', capabilities }
    );
    const silent = applyCommand(
      baseState(),
      { kind: 'setGlobalFlavor', value: 'dusk' },
      { phase: 'stopped', capabilities }
    );
    expect(warned.ok).toBe(true);
    expect(silent.ok).toBe(true);
    if (!warned.ok || !silent.ok) return;
    expect(warned.warnings).toHaveLength(1);
    expect(warned.warnings[0].intent).toBe('tempo');
    expect(silent.warnings).toEqual([]);
  });

  it('keeps earlier overrides intact when a later command warns', () => {
    const capabilities: CapabilitiesTable = {
      intents: { ...ALL_SUPPORTED.intents, tempo: 'unsupported' }
    };
    const state = mustApply(
      baseState(),
      { kind: 'setGlobalFlavor', value: 'dusk' },
      'stopped',
      capabilities
    );
    const result = applyCommand(
      state,
      { kind: 'setTempo', bpm: 90 },
      { phase: 'stopped', capabilities }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.state.staged).toEqual([
      { kind: 'setGlobalFlavor', value: 'dusk' },
      { kind: 'setTempo', bpm: 90 }
    ]);
  });
});

describe('applyCommand preserves application order', () => {
  it('keeps staged sets and clears in application order', () => {
    let state = baseState();
    state = mustApply(state, { kind: 'setGlobalFlavor', value: 'a' }, 'stopped');
    state = mustApply(state, { kind: 'clearGlobalFlavor' }, 'stopped');
    state = mustApply(state, { kind: 'setGlobalFlavor', value: 'b' }, 'stopped');
    // Clears are stored as ordinary overrides, never collapsed — the cascade
    // reads this order directly.
    expect(state.staged).toEqual([
      { kind: 'setGlobalFlavor', value: 'a' },
      { kind: 'clearGlobalFlavor' },
      { kind: 'setGlobalFlavor', value: 'b' }
    ]);
    expect(state.live).toEqual([]);
  });

  it('appends live overrides without touching staged', () => {
    let state = baseState();
    state = mustApply(
      state,
      { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.3 },
      'stopped'
    );
    state = mustApply(state, { kind: 'playTrack', trackId: 'track.lead' }, 'active');
    state = mustApply(state, { kind: 'clearTrackLevel', trackId: 'track.pad' }, 'active');
    expect(state.staged).toEqual([{ kind: 'setTrackLevel', trackId: 'track.pad', value: 0.3 }]);
    expect(state.live).toEqual([
      { kind: 'playTrack', trackId: 'track.lead' },
      { kind: 'clearTrackLevel', trackId: 'track.pad' }
    ]);
  });
});

describe('applyCommand never mutates its input', () => {
  it('returns a new frozen state and leaves the original untouched', () => {
    const state = baseState();
    const result = applyCommand(
      state,
      { kind: 'setGlobalFlavor', value: 'dawn' },
      { phase: 'active', capabilities: ALL_SUPPORTED }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).not.toBe(state);
    expect(state.live).toEqual([]);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.live)).toBe(true);
    expect(Object.isFrozen(result.state.staged)).toBe(true);
  });

  it("stores a canonical frozen copy, not the caller's command", () => {
    const command = { kind: 'setTempo', bpm: 120, extra: 'x' } as unknown as Command;
    const result = applyCommand(baseState(), command, {
      phase: 'stopped',
      capabilities: ALL_SUPPORTED
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = result.state.staged[0];
    expect(stored).not.toBe(command);
    expect(Object.isFrozen(stored)).toBe(true);
    // Only declared fields are stored, and later caller mutation changes nothing.
    expect(stored).toEqual({ kind: 'setTempo', bpm: 120 });
    (command as { bpm: number }).bpm = 999;
    expect(stored).toEqual({ kind: 'setTempo', bpm: 120 });
  });
});
