import { describe, expect, it, test } from 'vitest';
import type { CapabilitiesTable, IntentKeyword, IntentSupport } from '../../src/protocol/index.js';
import {
  applyCommand,
  applyCommands,
  createInputState,
  defineTrack,
  type Command,
  type CommandFailureCode,
  type InputState,
  type OverrideCommand
} from '../../src/core/index.js';
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
  capabilities: CapabilitiesTable = ALL_SUPPORTED
): InputState {
  const result = applyCommand(state, command, { capabilities });
  if (!result.ok) {
    throw new Error(`Expected the command to apply: ${result.failure.message}`);
  }
  return result.state;
}

// One valid fixture per override kind, against the fixture timeline's
// 'track.pad' / 'track.lead', with the intent keyword each command expresses
// (undefined for the structural play/stop commands and global level).
const OVERRIDES: ReadonlyArray<
  readonly [name: string, command: OverrideCommand, intent: IntentKeyword | undefined]
> = [
  ['playTrack', { kind: 'playTrack', trackId: 'track.pad' }, undefined],
  ['stopTrack', { kind: 'stopTrack', trackId: 'track.pad' }, undefined],
  ['clearTrackPlay', { kind: 'clearTrackPlay', trackId: 'track.pad' }, undefined],
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
  ['clearTrackNotes', { kind: 'clearTrackNotes', trackId: 'track.pad' }, 'notes'],
  ['setTrackMotif', { kind: 'setTrackMotif', trackId: 'track.pad', alda: 'c8 d e2' }, 'motif'],
  ['clearTrackMotif', { kind: 'clearTrackMotif', trackId: 'track.pad' }, 'motif'],
  ['setTempo', { kind: 'setTempo', bpm: 96 }, 'tempo'],
  ['clearTempo', { kind: 'clearTempo' }, 'tempo']
];

const INTENT_COMMANDS = OVERRIDES.filter(([, , intent]) => intent !== undefined) as ReadonlyArray<
  readonly [name: string, command: OverrideCommand, intent: IntentKeyword]
>;

const SETS = OVERRIDES.filter(([name]) => !name.startsWith('clear'));
const CLEARS = OVERRIDES.filter(([name]) => name.startsWith('clear'));

describe('applyCommand stores app values', () => {
  test.each(SETS)('%s is stored as an app value', (_name, command) => {
    const result = applyCommand(baseState(), command, { capabilities: ALL_SUPPORTED });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.appValues).toEqual([command]);
    expect(result.state.appTracks).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test.each(CLEARS)('%s is never stored', (_name, command) => {
    const result = applyCommand(baseState(), command, { capabilities: ALL_SUPPORTED });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.appValues).toEqual([]);
  });
});

describe('applyCommand keeps one value per slot', () => {
  it('keeps one entry when the same slot is set twice, moved to the end', () => {
    let state = baseState();
    state = mustApply(state, { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.3 });
    state = mustApply(state, { kind: 'setTempo', bpm: 90 });
    state = mustApply(state, { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.6 });
    expect(state.appValues).toEqual([
      { kind: 'setTempo', bpm: 90 },
      { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.6 }
    ]);
  });

  it('keeps slots on different tracks apart', () => {
    let state = baseState();
    state = mustApply(state, { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.3 });
    state = mustApply(state, { kind: 'setTrackLevel', trackId: 'track.lead', value: 0.6 });
    state = mustApply(state, { kind: 'setGlobalLevel', value: 0.9 });
    expect(state.appValues).toHaveLength(3);
  });

  it('removes the entry on a clear', () => {
    let state = baseState();
    state = mustApply(state, { kind: 'setGlobalFlavor', value: 'a' });
    state = mustApply(state, { kind: 'setTempo', bpm: 90 });
    state = mustApply(state, { kind: 'clearGlobalFlavor' });
    expect(state.appValues).toEqual([{ kind: 'setTempo', bpm: 90 }]);
  });

  it('treats playTrack, stopTrack and clearTrackPlay as one slot', () => {
    let state = baseState();
    state = mustApply(state, { kind: 'playTrack', trackId: 'track.pad' });
    state = mustApply(state, { kind: 'stopTrack', trackId: 'track.pad' });
    expect(state.appValues).toEqual([{ kind: 'stopTrack', trackId: 'track.pad' }]);
    state = mustApply(state, { kind: 'clearTrackPlay', trackId: 'track.pad' });
    expect(state.appValues).toEqual([]);
  });

  it('clears notes and motif', () => {
    let state = baseState();
    state = mustApply(state, { kind: 'setTrackNotes', trackId: 'track.pad', alda: 'c' });
    state = mustApply(state, { kind: 'setTrackMotif', trackId: 'track.pad', alda: 'd' });
    state = mustApply(state, { kind: 'clearTrackNotes', trackId: 'track.pad' });
    expect(state.appValues).toEqual([{ kind: 'setTrackMotif', trackId: 'track.pad', alda: 'd' }]);
    state = mustApply(state, { kind: 'clearTrackMotif', trackId: 'track.pad' });
    expect(state.appValues).toEqual([]);
  });
});

describe('applyCommand applies defineTrack', () => {
  it('appends an app track and no app value', () => {
    const result = applyCommand(
      baseState(),
      { kind: 'defineTrack', id: 'app.synth', name: 'Synth' },
      { capabilities: ALL_UNSUPPORTED }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.appTracks).toEqual([{ id: 'app.synth', name: 'Synth' }]);
    expect(result.state.appValues).toEqual([]);
    // Track identity is structural, not renderable intent — never warned about.
    expect(result.warnings).toEqual([]);
  });

  it('fails a duplicate id exactly like the standalone defineTrack', () => {
    const command = { kind: 'defineTrack', id: 'track.pad' } as const;
    const viaApply = applyCommand(baseState(), command, { capabilities: ALL_SUPPORTED });
    const standalone = defineTrack(baseState(), command);
    expect(viaApply.ok).toBe(false);
    expect(standalone.ok).toBe(false);
    if (viaApply.ok || standalone.ok) return;
    expect(viaApply.failure).toEqual(standalone.failure);
    expect(viaApply.failure.code).toBe('duplicate-track');
  });

  it('treats an identical app track definition as a no-op', () => {
    const state = mustApply(baseState(), { kind: 'defineTrack', id: 'app.a', name: 'A' });
    const again = applyCommand(
      state,
      { kind: 'defineTrack', id: 'app.a', name: 'A' },
      { capabilities: ALL_SUPPORTED }
    );
    expect(again).toEqual({ ok: true, state, warnings: [] });
    expect(again.ok && again.state).toBe(state);
  });

  it('rejects a different definition for an app track id', () => {
    const state = mustApply(baseState(), { kind: 'defineTrack', id: 'app.a', name: 'A' });
    const clash = applyCommand(
      state,
      { kind: 'defineTrack', id: 'app.a', name: 'B' },
      { capabilities: ALL_SUPPORTED }
    );
    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.failure.code).toBe('duplicate-track');
  });
});

describe('applyCommand applies removeTrack', () => {
  it("drops the app track and the track's values, and keeps other values", () => {
    let state = baseState();
    state = mustApply(state, { kind: 'defineTrack', id: 'app.bells' });
    state = mustApply(state, { kind: 'playTrack', trackId: 'app.bells' });
    state = mustApply(state, { kind: 'setTrackLevel', trackId: 'app.bells', value: 0.5 });
    state = mustApply(state, { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.2 });
    state = mustApply(state, { kind: 'setTempo', bpm: 100 });
    const result = applyCommand(
      state,
      { kind: 'removeTrack', trackId: 'app.bells' },
      { capabilities: ALL_UNSUPPORTED }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.appTracks).toEqual([]);
    expect(result.state.appValues).toEqual([
      { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.2 },
      { kind: 'setTempo', bpm: 100 }
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('lets the id be defined again afterwards', () => {
    let state = mustApply(baseState(), { kind: 'defineTrack', id: 'app.bells' });
    state = mustApply(state, { kind: 'removeTrack', trackId: 'app.bells' });
    expect(() => mustApply(state, { kind: 'defineTrack', id: 'app.bells' })).not.toThrow();
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
  [
    'clearTrackPlay on an unknown track',
    { kind: 'clearTrackPlay', trackId: 'track.ghost' },
    'unknown-track'
  ],
  [
    'clearTrackNotes on an unknown track',
    { kind: 'clearTrackNotes', trackId: 'track.ghost' },
    'unknown-track'
  ],
  [
    'clearTrackMotif on an unknown track',
    { kind: 'clearTrackMotif', trackId: 'track.ghost' },
    'unknown-track'
  ],
  [
    'removeTrack on an unknown track',
    { kind: 'removeTrack', trackId: 'track.ghost' },
    'unknown-track'
  ],
  [
    'removeTrack on a document track',
    { kind: 'removeTrack', trackId: 'track.pad' },
    'not-app-track'
  ],
  ['removeTrack without a track id', { kind: 'removeTrack' }, 'invalid-value'],
  ['an unrecognized command kind', { kind: 'warble' }, 'invalid-value'],
  ['a null command', null, 'invalid-value'],
  ['a missing command', undefined, 'invalid-value']
];

describe('applyCommand rejects invalid commands', () => {
  test.each(REJECTIONS)('rejects %s', (_name, command, code) => {
    const state = baseState();
    const result = applyCommand(state, command as Command, { capabilities: ALL_SUPPORTED });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe(code);
    expect(result.failure.message.length).toBeGreaterThan(0);
    if (code === 'unknown-track') {
      expect(result.failure.trackId).toBe('track.ghost');
    }
    expect(state.appValues).toEqual([]);
    expect(state.appTracks).toEqual([]);
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
    const result = applyCommand(baseState(), command, { capabilities: ALL_SUPPORTED });
    expect(result.ok).toBe(true);
  });
});

describe('applyCommand warns from the capabilities table', () => {
  test.each(INTENT_COMMANDS)(
    '%s warns when its intent is unsupported',
    (_name, command, intent) => {
      const result = applyCommand(baseState(), command, { capabilities: ALL_UNSUPPORTED });
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
      // Warn, never drop: a set is stored despite the warning.
      if (!command.kind.startsWith('clear')) {
        expect(result.state.appValues).toEqual([command]);
      }
    }
  );

  test.each(INTENT_COMMANDS)('%s warns more softly when approximated', (_name, command, intent) => {
    const approximated = applyCommand(baseState(), command, { capabilities: ALL_APPROXIMATED });
    const unsupported = applyCommand(baseState(), command, { capabilities: ALL_UNSUPPORTED });
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
    ['clearTrackPlay', { kind: 'clearTrackPlay', trackId: 'track.pad' }],
    ['defineTrack', { kind: 'defineTrack', id: 'app.synth' }]
  ];

  test.each(STRUCTURAL)(
    '%s never warns, even when every intent is unsupported',
    (_name, command) => {
      const result = applyCommand(baseState(), command, { capabilities: ALL_UNSUPPORTED });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
    }
  );

  it('treats global level as Renderer-owned while track level still follows capabilities', () => {
    const global = applyCommand(
      baseState(),
      { kind: 'setGlobalLevel', value: 0.5 },
      { capabilities: ALL_UNSUPPORTED }
    );
    const track = applyCommand(
      baseState(),
      { kind: 'setTrackLevel', trackId: 'track.pad', value: 0.5 },
      { capabilities: ALL_APPROXIMATED }
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
      { capabilities: ALL_UNSUPPORTED }
    );
    const clear = applyCommand(
      baseState(),
      { kind: 'clearTrackTimbre', trackId: 'track.pad' },
      { capabilities: ALL_UNSUPPORTED }
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
    const warned = applyCommand(baseState(), { kind: 'setTempo', bpm: 90 }, { capabilities });
    const silent = applyCommand(
      baseState(),
      { kind: 'setGlobalFlavor', value: 'dusk' },
      { capabilities }
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
    const state = mustApply(baseState(), { kind: 'setGlobalFlavor', value: 'dusk' }, capabilities);
    const result = applyCommand(state, { kind: 'setTempo', bpm: 90 }, { capabilities });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.state.appValues).toEqual([
      { kind: 'setGlobalFlavor', value: 'dusk' },
      { kind: 'setTempo', bpm: 90 }
    ]);
  });
});

describe('applyCommands applies a group fully or not at all', () => {
  it('applies every command in order and collects every warning', () => {
    const result = applyCommands(
      baseState(),
      [
        { kind: 'defineTrack', id: 'app.bells' },
        { kind: 'playTrack', trackId: 'app.bells' },
        { kind: 'setTempo', bpm: 90 },
        { kind: 'setTrackTimbre', trackId: 'app.bells', value: 'glass' }
      ],
      { capabilities: ALL_UNSUPPORTED }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.appTracks).toEqual([{ id: 'app.bells' }]);
    expect(result.state.appValues).toHaveLength(3);
    expect(result.warnings.map((warning) => warning.intent)).toEqual(['tempo', 'timbre']);
  });

  it('leaves the state untouched when a later command fails', () => {
    const state = mustApply(baseState(), { kind: 'setTempo', bpm: 80 });
    const result = applyCommands(
      state,
      [
        { kind: 'defineTrack', id: 'app.bells' },
        { kind: 'setTempo', bpm: 120 },
        { kind: 'setTrackLevel', trackId: 'track.pad', value: 4 }
      ],
      { capabilities: ALL_SUPPORTED }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('invalid-level');
    expect(result.index).toBe(2);
    expect(state.appValues).toEqual([{ kind: 'setTempo', bpm: 80 }]);
    expect(state.appTracks).toEqual([]);
  });

  it('accepts an empty group', () => {
    const state = baseState();
    const result = applyCommands(state, [], { capabilities: ALL_SUPPORTED });
    expect(result).toEqual({ ok: true, state, warnings: [] });
  });

  it('rejects a group that is not a list', () => {
    const result = applyCommands(baseState(), 'setTempo' as unknown as Command[], {
      capabilities: ALL_SUPPORTED
    });
    expect(result.ok).toBe(false);
  });
});

describe('applyCommand never mutates its input', () => {
  it('returns a new frozen state and leaves the original untouched', () => {
    const state = baseState();
    const result = applyCommand(
      state,
      { kind: 'setGlobalFlavor', value: 'dawn' },
      { capabilities: ALL_SUPPORTED }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).not.toBe(state);
    expect(state.appValues).toEqual([]);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.appValues)).toBe(true);
    expect(Object.isFrozen(result.state.appTracks)).toBe(true);
  });

  it("stores a canonical frozen copy, not the caller's command", () => {
    const command = { kind: 'setTempo', bpm: 120, extra: 'x' } as unknown as Command;
    const result = applyCommand(baseState(), command, { capabilities: ALL_SUPPORTED });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = result.state.appValues[0];
    expect(stored).not.toBe(command);
    expect(Object.isFrozen(stored)).toBe(true);
    // Only declared fields are stored, and later caller mutation changes nothing.
    expect(stored).toEqual({ kind: 'setTempo', bpm: 120 });
    (command as { bpm: number }).bpm = 999;
    expect(stored).toEqual({ kind: 'setTempo', bpm: 120 });
  });
});
