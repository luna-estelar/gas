import * as ast from '../generated/ast.js';
import type { GasNode, TrackCommand } from './ast.js';
import { informationalDiagnostic, semanticDiagnostic, type GasDiagnostic } from './diagnostics.js';
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

/**
 * A single parsed live statement. Track declarations and `tempo` are live-only shapes;
 * everything else reuses the same TrackCommand union authored documents compile to, so
 * Core applies live and authored track commands through one code path.
 */
export type LiveStatement = LiveTrackDeclaration | LiveTempoCommand | TrackCommand;

export interface LiveBuildResult {
  readonly statements: readonly LiveStatement[];
  readonly diagnostics: readonly GasDiagnostic[];
}

/**
 * Projects a structurally-valid Model onto the live command surface. Unlike buildDocument,
 * this never resolves track names against a namespace — Core resolves live statements
 * against the running session's tracks, which this parser cannot see — and it rejects
 * document-only constructs (sections, arrangement calls, non-tempo globals) instead of
 * lowering them.
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
      const command = lowering.trackCommand(element);
      if (command.kind === 'Level' && !isValidLevel(command.value)) {
        diagnostics.push(
          semanticDiagnostic(
            'invalid-level',
            'error',
            `Level must be between 0 and 1, got ${command.value}.`,
            command.range
          )
        );
      }
      if (command.kind === 'Notes' || command.kind === 'Motif') {
        const keyword = command.kind === 'Notes' ? 'notes' : 'motif';
        diagnostics.push(
          informationalDiagnostic(
            'lyria-unsupported-intent',
            `GAS accepts ${command.trackName}.${keyword}, but Lyria realtime v1 will warn and drop it.`,
            command.range
          )
        );
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

function globalKeyword(declaration: ast.GlobalDeclaration): string {
  if (ast.isKeyDeclaration(declaration)) {
    return 'key';
  }
  if (ast.isTimeSignatureDeclaration(declaration)) {
    return 'time_signature';
  }
  if (ast.isGlobalLengthDeclaration(declaration)) {
    return 'length';
  }
  if (ast.isLevelDeclaration(declaration)) {
    return 'level';
  }
  return 'flavor';
}
