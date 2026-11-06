import { describe, expect, test } from 'vitest';
import { parseLiveCommands, type LiveCommandResult } from '../../src/language/index.js';

function codes(result: LiveCommandResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function categories(result: LiveCommandResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.category);
}

function expectStatements(result: LiveCommandResult) {
  if (!result.ok) {
    throw new Error(
      `Expected accepted live statements, got diagnostics: ${codes(result).join(', ')}`
    );
  }
  return result.statements;
}

describe('parseLiveCommands acceptance', () => {
  test('accepts an empty fragment', () => {
    const result = parseLiveCommands('');
    expect(result.ok).toBe(true);
    expect(expectStatements(result)).toEqual([]);
  });

  test('accepts a track declaration', () => {
    const statements = expectStatements(parseLiveCommands('track lead "bright square lead"'));
    expect(statements).toEqual([
      expect.objectContaining({
        kind: 'DeclareTrack',
        name: 'lead',
        description: 'bright square lead'
      })
    ]);
  });

  test('accepts play and stop', () => {
    const statements = expectStatements(parseLiveCommands('lead.play\nlead.stop'));
    expect(statements.map((statement) => statement.kind)).toEqual(['Play', 'Stop']);
  });

  test('accepts flavor, timbre, and level track commands', () => {
    const statements = expectStatements(
      parseLiveCommands(
        'lead.flavor "play short answers"\nlead.timbre "square wave"\nlead.level 0.6'
      )
    );
    expect(statements).toEqual([
      expect.objectContaining({ kind: 'Flavor', trackName: 'lead', value: 'play short answers' }),
      expect.objectContaining({ kind: 'Timbre', trackName: 'lead' }),
      expect.objectContaining({ kind: 'Level', trackName: 'lead', value: 0.6 })
    ]);
  });

  test('accepts notes and motif with no model-specific diagnostics', () => {
    const result = parseLiveCommands('lead.notes alda(o4 c d e)');
    expect(result.ok).toBe(true);
    expect(expectStatements(result)).toEqual([
      expect.objectContaining({ kind: 'Notes', trackName: 'lead' })
    ]);
    expect(codes(result)).toEqual([]);
  });

  test('accepts tempo', () => {
    const statements = expectStatements(parseLiveCommands('tempo 132'));
    expect(statements).toEqual([expect.objectContaining({ kind: 'Tempo', bpm: 132 })]);
  });

  test('accepts fractional tempo without rounding', () => {
    const statements = expectStatements(parseLiveCommands('tempo 123.5'));
    expect(statements).toEqual([expect.objectContaining({ kind: 'Tempo', bpm: 123.5 })]);
  });

  test('accepts the spec example as an ordered statement list', () => {
    const statements = expectStatements(
      parseLiveCommands(`
track lead "bright square lead"
lead.flavor "play short answers"
lead.play
tempo 132
`)
    );
    expect(statements.map((statement) => statement.kind)).toEqual([
      'DeclareTrack',
      'Flavor',
      'Play',
      'Tempo'
    ]);
  });

  test('accepts a command referencing a track not declared in the fragment', () => {
    const statements = expectStatements(parseLiveCommands('bass.play'));
    expect(statements).toEqual([expect.objectContaining({ kind: 'Play', trackName: 'bass' })]);
  });

  test('accepts a contextual keyword as a track name', () => {
    const statements = expectStatements(
      parseLiveCommands('track prompt "a prompt-named track"\nprompt.play')
    );
    expect(statements.map((statement) => statement.kind)).toEqual(['DeclareTrack', 'Play']);
  });
});

describe('parseLiveCommands clears and globals', () => {
  test('accepts global flavor and level', () => {
    const statements = expectStatements(parseLiveCommands('flavor "late-night"\nlevel 0.5'));
    expect(statements).toEqual([
      expect.objectContaining({ kind: 'GlobalFlavor', value: 'late-night' }),
      expect.objectContaining({ kind: 'GlobalLevel', value: 0.5 })
    ]);
  });

  test('rejects a global level out of range', () => {
    expect(codes(parseLiveCommands('level 1.5'))).toContain('invalid-level');
  });

  test.each(['flavor', 'timbre', 'level', 'notes', 'motif'] as const)(
    'accepts a %s clear on a track',
    (slot) => {
      expect(expectStatements(parseLiveCommands(`lead.${slot} clear`))).toEqual([
        expect.objectContaining({ kind: 'ClearTrack', trackName: 'lead', slot })
      ]);
    }
  );

  test.each(['tempo', 'flavor', 'level'] as const)('accepts a global %s clear', (slot) => {
    expect(expectStatements(parseLiveCommands(`${slot} clear`))).toEqual([
      expect.objectContaining({ kind: 'ClearGlobal', slot })
    ]);
  });

  test('accepts release and track removal', () => {
    expect(expectStatements(parseLiveCommands('lead.release\ntrack lead clear'))).toEqual([
      expect.objectContaining({ kind: 'Release', trackName: 'lead' }),
      expect.objectContaining({ kind: 'RemoveTrack', name: 'lead' })
    ]);
  });

  test('keeps clear and release usable as track names', () => {
    const statements = expectStatements(
      parseLiveCommands('track clear "c"\nclear.play\ntrack release "r"\nrelease.level clear')
    );
    expect(statements).toEqual([
      expect.objectContaining({ kind: 'DeclareTrack', name: 'clear' }),
      expect.objectContaining({ kind: 'Play', trackName: 'clear' }),
      expect.objectContaining({ kind: 'DeclareTrack', name: 'release' }),
      expect.objectContaining({ kind: 'ClearTrack', trackName: 'release', slot: 'level' })
    ]);
  });

  test('rejects a clear with a value', () => {
    const result = parseLiveCommands('strings.level clear 0.3');
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain('syntax');
  });
});

describe('parseLiveCommands exclusions', () => {
  test('rejects a section definition', () => {
    const result = parseLiveCommands('section intro:\n    bar 1:\n        drums.play\n');
    expect(result.ok).toBe(false);
    expect(result.statements).toBeUndefined();
  });

  test('rejects an arrangement call', () => {
    const result = parseLiveCommands('chorus()');
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('live-arrangement-not-allowed');
  });

  test('rejects a bar block', () => {
    const result = parseLiveCommands('bar 1:\n    drums.play\n');
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain('syntax');
  });

  test('rejects a bare play', () => {
    const result = parseLiveCommands('play()');
    expect(result.ok).toBe(false);
  });

  test('rejects a bare stop', () => {
    const result = parseLiveCommands('stop()');
    expect(result.ok).toBe(false);
  });

  for (const [source, label] of [
    ['key "D minor"', 'key'],
    ['time_signature 4/4', 'time_signature'],
    ['length bars 16', 'length']
  ] as const) {
    test(`rejects a global ${label} declaration`, () => {
      const result = parseLiveCommands(source);
      expect(result.ok).toBe(false);
      expect(codes(result)).toContain('live-global-not-allowed');
    });
  }

  test('rejects a reserved statement with a deferred diagnostic', () => {
    const result = parseLiveCommands(
      'track lead "bright square lead"\nlead.prompt "a direct prompt"'
    );
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain('deferred');
  });
});

describe('parseLiveCommands whole-input semantics', () => {
  test('a structural error in statement 3 of 5 rejects the whole parse with no partial statement list', () => {
    const result = parseLiveCommands(`
track lead "bright square lead"
lead.play
section intro:
    bar 1:
        lead.play
tempo 132
`);
    expect(result.ok).toBe(false);
    expect(result.statements).toBeUndefined();
  });

  test('rejects an out-of-range tempo', () => {
    const result = parseLiveCommands('tempo 0');
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('invalid-tempo');
  });

  test('rejects a fractional tempo below the lower bound', () => {
    const result = parseLiveCommands('tempo 0.5');
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('invalid-tempo');
  });

  test('rejects an out-of-range level', () => {
    const result = parseLiveCommands('lead.level 2');
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('invalid-level');
  });

  test('carries source ranges on every statement', () => {
    const statements = expectStatements(parseLiveCommands('lead.play'));
    expect(statements[0]?.range).toEqual(
      expect.objectContaining({
        start: expect.objectContaining({ line: 0 }),
        end: expect.objectContaining({ line: 0 })
      })
    );
  });
});
