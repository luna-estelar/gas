import type { AstNode } from 'langium';
import * as ast from '../generated/ast.js';
import type {
  AldaSnippet,
  FlavorCommand,
  GasNode,
  GasSourceRange,
  LevelCommand,
  MotifCommand,
  NotesCommand,
  PlayCommand,
  StopCommand,
  StringValue,
  TimbreCommand,
  TrackCommand
} from './ast.js';
import { deferredDiagnostic, type GasDiagnostic } from './diagnostics.js';

const fallbackRange: GasSourceRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 }
};

export function rangeOf(node: AstNode | undefined): GasSourceRange {
  return node?.$cstNode?.range ?? fallbackRange;
}

export function unquoteString(raw: string): string {
  if (raw.length < 2) {
    return raw;
  }
  const quote = raw[0];
  if ((quote !== '"' && quote !== "'") || raw[raw.length - 1] !== quote) {
    return raw;
  }

  const chunks: string[] = [];
  for (let index = 1; index < raw.length - 1; index++) {
    const char = raw[index];
    if (char !== '\\') {
      chunks.push(char);
      continue;
    }

    index++;
    if (index >= raw.length - 1) {
      chunks.push('\\');
      break;
    }

    const escaped = raw[index];
    if (escaped === 'n') {
      chunks.push('\n');
    } else if (escaped === 'r') {
      chunks.push('\r');
    } else if (escaped === 't') {
      chunks.push('\t');
    } else if (escaped === 'b') {
      chunks.push('\b');
    } else if (escaped === 'f') {
      chunks.push('\f');
    } else if (escaped === 'v') {
      chunks.push('\v');
    } else {
      chunks.push(escaped);
    }
  }
  return chunks.join('');
}

function stripAldaWrapper(raw: string): string {
  return raw.startsWith('alda(') && raw.endsWith(')') ? raw.slice(5, -1) : raw;
}

/**
 * Assigns monotonically increasing sourceOrder values and lowers Langium track-command
 * nodes into the package-owned semantic shapes. Shared by the document builder and the
 * live-command builder so both project the same TrackCommand union the same way.
 */
export class NodeLowering {
  private sourceOrder = 0;

  base(node: AstNode | undefined): GasNode {
    return {
      kind: 'Node',
      range: rangeOf(node),
      sourceOrder: this.sourceOrder++
    };
  }

  stringValue(value: string, node: AstNode | undefined): StringValue {
    return {
      ...this.base(node),
      kind: 'String',
      value: unquoteString(value)
    };
  }

  aldaSnippet(value: ast.AldaValue | undefined): AldaSnippet {
    return {
      ...this.base(value),
      kind: 'Alda',
      raw: stripAldaWrapper(value?.raw ?? '')
    };
  }

  trackCommand(statement: ast.TrackStatement): TrackCommand {
    const command = statement.command;
    const base = {
      ...this.base(statement),
      trackName: statement.track.$refText
    };

    if (ast.isPlayCommand(command)) {
      return { ...base, kind: 'Play' } satisfies PlayCommand;
    }
    if (ast.isStopCommand(command)) {
      return { ...base, kind: 'Stop' } satisfies StopCommand;
    }
    if (ast.isFlavorCommand(command)) {
      return {
        ...base,
        kind: 'Flavor',
        value: unquoteString(command.value ?? '')
      } satisfies FlavorCommand;
    }
    if (ast.isTimbreCommand(command)) {
      return {
        ...base,
        kind: 'Timbre',
        value: this.stringValue(command.value ?? '', command)
      } satisfies TimbreCommand;
    }
    if (ast.isLevelCommand(command)) {
      return { ...base, kind: 'Level', value: command.value ?? Number.NaN } satisfies LevelCommand;
    }
    if (ast.isNotesCommand(command)) {
      return {
        ...base,
        kind: 'Notes',
        value: this.aldaSnippet(command.value)
      } satisfies NotesCommand;
    }
    return {
      ...base,
      kind: 'Motif',
      value: this.aldaSnippet(command.value)
    } satisfies MotifCommand;
  }
}

function reservedFeature(command: ast.ReservedGlobalCommand | ast.ReservedTrackCommand): string {
  if (ast.isLyricsThemeReservedCommand(command)) {
    return 'lyrics.theme';
  }
  if (ast.isLyricsReservedCommand(command)) {
    return 'lyrics';
  }
  if (ast.isEffectReservedCommand(command)) {
    return 'effect';
  }
  if (ast.isExtendReservedCommand(command)) {
    return 'extend';
  }
  return 'prompt';
}

function reservedMessage(feature: string): string {
  if (feature === 'lyrics' || feature === 'lyrics.theme') {
    return 'Lyrics are reserved for after v1.';
  }
  if (feature === 'effect') {
    return 'Effects are reserved for after v1; describe the sound with flavor for now.';
  }
  if (feature === 'extend') {
    return 'Renderer extension syntax is reserved for after v1.';
  }
  return 'Direct model prompts are reserved for after v1; use GAS intent like flavor and timbre instead.';
}

export function reservedDiagnostic(statement: ast.ReservedStatement): GasDiagnostic {
  const command = ast.isReservedGlobalStatement(statement) ? statement.command : statement.command;
  const feature = reservedFeature(command);
  return deferredDiagnostic(
    `reserved-${feature.replace('.', '-')}`,
    reservedMessage(feature),
    rangeOf(statement)
  );
}
