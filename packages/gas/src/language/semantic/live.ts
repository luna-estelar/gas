import * as ast from '../generated/ast.js';
import type { GasNode, TrackCommand } from './ast.js';
import { semanticDiagnostic, type GasDiagnostic } from './diagnostics.js';
import { NodeLowering, rangeOf, reservedDiagnostic, unquoteString } from './lower.js';

export interface LiveTrackDeclaration extends GasNode {
  readonly kind: 'DeclareTrack';
  readonly name: string;
  readonly description: string;
}

export interface LiveTempoCommand extends GasNode {
  readonly kind: 'Tempo';
  readonly bpm: number;
}

export interface LiveGlobalFlavor extends GasNode {
  readonly kind: 'GlobalFlavor';
  readonly value: string;
}

export interface LiveGlobalLevel extends GasNode {
  readonly kind: 'GlobalLevel';
  readonly value: number;
}

/** `tempo clear`, `flavor clear` or `level clear`. */
export interface LiveGlobalClear extends GasNode {
  readonly kind: 'ClearGlobal';
  readonly slot: 'tempo' | 'flavor' | 'level';
}

/** `<track>.<slot> clear`. */
export interface LiveTrackClear extends GasNode {
  readonly kind: 'ClearTrack';
  readonly trackName: string;
  readonly slot: 'flavor' | 'timbre' | 'level' | 'notes' | 'motif';
}

/** `<track>.release`: the score decides when the track plays again. */
export interface LiveTrackRelease extends GasNode {
  readonly kind: 'Release';
  readonly trackName: string;
}

/** `track <name> clear`: removes an app track. */
export interface LiveTrackRemoval extends GasNode {
  readonly kind: 'RemoveTrack';
  readonly name: string;
}

/**
 * A single parsed live statement. Declarations, globals, clears and `release` are
 * live-only shapes; the track commands reuse the same TrackCommand union authored
 * documents compile to, so Core applies live and authored track commands through one
 * code path.
 */
export type LiveStatement =
  | LiveTrackDeclaration
  | LiveTrackRemoval
  | LiveTempoCommand
  | LiveGlobalFlavor
  | LiveGlobalLevel
  | LiveGlobalClear
  | LiveTrackClear
  | LiveTrackRelease
  | TrackCommand;

export interface LiveBuildResult {
  readonly statements: readonly LiveStatement[];
  readonly diagnostics: readonly GasDiagnostic[];
}

/**
 * Projects a structurally-valid Model onto the live command surface. Unlike buildDocument,
 * this never resolves track names against a namespace — Core resolves live statements
 * against the running session's tracks, which this parser cannot see — and it rejects
 * document-only constructs (sections, arrangement calls, key, time signature and length)
 * instead of lowering them.
 */
export function buildLiveCommands(model: ast.Model): LiveBuildResult {
  const diagnostics: GasDiagnostic[] = [];
  const lowering = new NodeLowering();
  const statements: LiveStatement[] = [];

  for (const element of model.elements) {
    if (ast.isTrackDeclaration(element)) {
      statements.push({
        ...lowering.base(element),
        kind: 'DeclareTrack',
        name: element.name,
        description: unquoteString(element.description)
      });
      continue;
    }

    if (ast.isTrackRemoval(element)) {
      statements.push({ ...lowering.base(element), kind: 'RemoveTrack', name: element.name });
      continue;
    }

    if (ast.isGlobalClear(element)) {
      statements.push({ ...lowering.base(element), kind: 'ClearGlobal', slot: element.slot });
      continue;
    }

    if (ast.isFlavorDeclaration(element)) {
      statements.push({
        ...lowering.base(element),
        kind: 'GlobalFlavor',
        value: unquoteString(element.value)
      });
      continue;
    }

    if (ast.isLevelDeclaration(element)) {
      const level: LiveGlobalLevel = {
        ...lowering.base(element),
        kind: 'GlobalLevel',
        value: element.value
      };
      if (!isValidLevel(level.value)) diagnostics.push(invalidLevel(level.value, level.range));
      statements.push(level);
      continue;
    }

    if (ast.isTempoDeclaration(element)) {
      const tempo: LiveTempoCommand = {
        ...lowering.base(element),
        kind: 'Tempo',
        bpm: element.bpm
      };
      if (tempo.bpm < 1) {
        diagnostics.push(
          semanticDiagnostic(
            'invalid-tempo',
            'error',
            `Tempo must be at least 1 bpm, got ${tempo.bpm}.`,
            tempo.range
          )
        );
      }
      statements.push(tempo);
      continue;
    }

    if (ast.isTrackStatement(element)) {
      const trackName = element.track.$refText;
      if (ast.isClearCommand(element.command)) {
        // A clear without its slot is a syntax error, so it never reaches here.
        const slot = element.command.slot ?? 'flavor';
        statements.push({ ...lowering.base(element), kind: 'ClearTrack', trackName, slot });
        continue;
      }
      if (ast.isReleaseCommand(element.command)) {
        statements.push({ ...lowering.base(element), kind: 'Release', trackName });
        continue;
      }
      const command = lowering.trackCommand(element);
      if (command.kind === 'Level' && !isValidLevel(command.value)) {
        diagnostics.push(invalidLevel(command.value, command.range));
      }
      statements.push(command);
      continue;
    }

    if (ast.isReservedStatement(element)) {
      diagnostics.push(reservedDiagnostic(element));
      continue;
    }

    if (ast.isGlobalDeclaration(element)) {
      diagnostics.push(
        semanticDiagnostic(
          'live-global-not-allowed',
          'error',
          `\`${globalKeyword(element)}\` is only allowed in a full GAS document, not a live command.`,
          rangeOf(element)
        )
      );
      continue;
    }

    if (ast.isSectionDeclaration(element)) {
      diagnostics.push(
        semanticDiagnostic(
          'live-section-not-allowed',
          'error',
          "Sections aren't allowed in live commands — declare and play tracks instead.",
          rangeOf(element)
        )
      );
      continue;
    }

    if (ast.isSectionCall(element)) {
      diagnostics.push(
        semanticDiagnostic(
          'live-arrangement-not-allowed',
          'error',
          "Arrangement calls aren't allowed in live commands.",
          rangeOf(element)
        )
      );
    }
  }

  return { statements, diagnostics };
}

function isValidLevel(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function invalidLevel(value: number, range: GasNode['range']): GasDiagnostic {
  return semanticDiagnostic(
    'invalid-level',
    'error',
    `Level must be between 0 and 1, got ${value}.`,
    range
  );
}

// Flavor, level and tempo are handled above, so only document-only globals reach here.
function globalKeyword(declaration: ast.GlobalDeclaration): string {
  if (ast.isKeyDeclaration(declaration)) {
    return 'key';
  }
  if (ast.isTimeSignatureDeclaration(declaration)) {
    return 'time_signature';
  }
  return 'length';
}
