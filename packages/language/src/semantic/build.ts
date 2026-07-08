import type { AstNode } from 'langium';
import * as ast from '../generated/ast.js';
import type {
  AldaSnippet,
  Bar,
  FlavorCommand,
  FlavorGlobal,
  GasDocument,
  GasNode,
  GasSourceRange,
  Global,
  GlobalLength,
  Globals,
  KeyGlobal,
  LevelCommand,
  LevelGlobal,
  MotifCommand,
  NotesCommand,
  PlayCommand,
  Section,
  SectionLength,
  SectionPlay,
  StopCommand,
  StringValue,
  TempoGlobal,
  TimeSignatureGlobal,
  TimbreCommand,
  Track,
  TrackCommand
} from './ast.js';
import { deferredDiagnostic, semanticDiagnostic, type GasDiagnostic } from './diagnostics.js';

export interface BuildResult {
  readonly document: GasDocument;
  readonly diagnostics: readonly GasDiagnostic[];
}

interface TrackRecord {
  readonly track: Track;
  readonly defaults: TrackCommand[];
}

const fallbackRange: GasSourceRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 }
};

export function buildDocument(model: ast.Model): BuildResult {
  return new SemanticBuilder().build(model);
}

class SemanticBuilder {
  private readonly diagnostics: GasDiagnostic[] = [];
  private sourceOrder = 0;

  build(model: ast.Model): BuildResult {
    const globals = this.createGlobals();
    const tracks: Track[] = [];
    const tracksByName = new Map<string, Track>();
    const trackRecords = new Map<string, TrackRecord>();
    const sections: Section[] = [];
    const sectionsByName = new Map<string, Section>();
    const arrangement: SectionPlay[] = [];
    const orphanCommands: TrackCommand[] = [];

    for (const element of model.elements) {
      if (ast.isGlobalDeclaration(element)) {
        this.appendGlobal(globals, element);
      } else if (ast.isReservedStatement(element)) {
        this.appendReservedDiagnostic(element);
      } else if (ast.isTrackDeclaration(element)) {
        const defaults: TrackCommand[] = [];
        const track: Track = {
          ...this.base(element),
          kind: 'Track',
          name: element.name,
          description: unquoteString(element.description),
          defaults
        };
        tracks.push(track);
        if (tracksByName.has(element.name)) {
          this.diagnostics.push(
            semanticDiagnostic(
              'duplicate-track',
              'error',
              `Track '${element.name}' is already declared; the first declaration is used.`,
              track.range
            )
          );
        } else {
          tracksByName.set(element.name, track);
          trackRecords.set(element.name, { track, defaults });
        }
      }
    }

    for (const element of model.elements) {
      if (ast.isSectionDeclaration(element)) {
        const section = this.buildSection(element, tracksByName, orphanCommands);
        sections.push(section);
        if (sectionsByName.has(element.name)) {
          this.diagnostics.push(
            semanticDiagnostic(
              'duplicate-section',
              'error',
              `Section '${element.name}' is already declared; the first declaration is used.`,
              section.range
            )
          );
        } else {
          sectionsByName.set(element.name, section);
        }
      }
    }

    for (const element of model.elements) {
      if (ast.isTrackStatement(element)) {
        const command = this.buildTrackCommand(element);
        const record = trackRecords.get(command.trackName);
        if (record !== undefined) {
          record.defaults.push(command);
        } else {
          orphanCommands.push(command);
          this.diagnostics.push(unresolvedTrackDiagnostic(command));
        }
      } else if (ast.isSectionCall(element)) {
        const call: SectionPlay = {
          ...this.base(element),
          kind: 'SectionPlay',
          sectionName: element.section.$refText
        };
        arrangement.push(call);
        if (!sectionsByName.has(call.sectionName)) {
          this.diagnostics.push(
            semanticDiagnostic(
              'unresolved-section',
              'error',
              `I cannot find a section named '${call.sectionName}' for this arrangement call.`,
              call.range
            )
          );
        }
      }
    }

    return {
      document: {
        ...this.base(model),
        kind: 'Document',
        globals,
        tracks,
        tracksByName,
        sections,
        sectionsByName,
        arrangement,
        orphanCommands
      },
      diagnostics: this.diagnostics
    };
  }

  private createGlobals(): Globals {
    return { all: [] };
  }

  private appendGlobal(globals: Globals, declaration: ast.GlobalDeclaration): void {
    const global = this.buildGlobal(declaration);
    (globals.all as Global[]).push(global);

    if (global.kind === 'Tempo' && globals.tempo === undefined) {
      (globals as { tempo?: TempoGlobal }).tempo = global;
    } else if (global.kind === 'Key' && globals.key === undefined) {
      (globals as { key?: KeyGlobal }).key = global;
    } else if (global.kind === 'TimeSignature' && globals.timeSignature === undefined) {
      (globals as { timeSignature?: TimeSignatureGlobal }).timeSignature = global;
    } else if (global.kind === 'Length' && globals.length === undefined) {
      (globals as { length?: GlobalLength }).length = global;
    } else if (global.kind === 'Flavor' && globals.flavor === undefined) {
      (globals as { flavor?: FlavorGlobal }).flavor = global;
    } else if (global.kind === 'Level' && globals.level === undefined) {
      (globals as { level?: LevelGlobal }).level = global;
    }
  }

  private buildGlobal(declaration: ast.GlobalDeclaration): Global {
    if (ast.isTempoDeclaration(declaration)) {
      return { ...this.base(declaration), kind: 'Tempo', bpm: declaration.bpm };
    }
    if (ast.isKeyDeclaration(declaration)) {
      return { ...this.base(declaration), kind: 'Key', value: unquoteString(declaration.value) };
    }
    if (ast.isTimeSignatureDeclaration(declaration)) {
      return {
        ...this.base(declaration),
        kind: 'TimeSignature',
        numerator: declaration.numerator,
        denominator: declaration.denominator
      };
    }
    if (ast.isGlobalLengthDeclaration(declaration)) {
      return this.buildGlobalLength(declaration);
    }
    if (ast.isLevelDeclaration(declaration)) {
      return { ...this.base(declaration), kind: 'Level', value: declaration.value };
    }
    return { ...this.base(declaration), kind: 'Flavor', value: unquoteString(declaration.value) };
  }

  private buildGlobalLength(declaration: ast.GlobalLengthDeclaration): GlobalLength {
    const length = declaration.length;
    if (ast.isInfiniteLength(length)) {
      return { ...this.base(declaration), kind: 'Length', mode: 'infinite' };
    }
    return {
      ...this.base(declaration),
      kind: 'Length',
      mode: length.loop ? 'loop' : 'finite',
      bars: length.bars
    };
  }

  private buildSection(
    declaration: ast.SectionDeclaration,
    tracksByName: ReadonlyMap<string, Track>,
    orphanCommands: TrackCommand[]
  ): Section {
    const flavors: FlavorGlobal[] = [];
    const setup: TrackCommand[] = [];
    const bars: Bar[] = [];
    let length: SectionLength | undefined;

    for (const item of declaration.items) {
      if (ast.isSectionLengthDeclaration(item)) {
        length = {
          ...this.base(item),
          kind: 'SectionLength',
          bars: item.length.bars
        };
      } else if (ast.isFlavorDeclaration(item)) {
        flavors.push({ ...this.base(item), kind: 'Flavor', value: unquoteString(item.value) });
      } else if (ast.isReservedStatement(item)) {
        this.appendReservedDiagnostic(item);
      } else if (ast.isTrackStatement(item)) {
        const command = this.buildTrackCommand(item);
        setup.push(command);
        if (!tracksByName.has(command.trackName)) {
          orphanCommands.push(command);
          this.diagnostics.push(unresolvedTrackDiagnostic(command));
        }
      } else if (ast.isBarBlock(item)) {
        bars.push(this.buildBar(item, tracksByName, orphanCommands));
      }
    }

    return {
      ...this.base(declaration),
      kind: 'Section',
      name: declaration.name,
      length,
      flavors,
      setup,
      bars
    };
  }

  private buildBar(
    block: ast.BarBlock,
    tracksByName: ReadonlyMap<string, Track>,
    orphanCommands: TrackCommand[]
  ): Bar {
    const commands: TrackCommand[] = [];
    for (const statement of block.commands) {
      if (ast.isReservedStatement(statement)) {
        this.appendReservedDiagnostic(statement);
        continue;
      }
      const command = this.buildTrackCommand(statement);
      commands.push(command);
      if (!tracksByName.has(command.trackName)) {
        orphanCommands.push(command);
        this.diagnostics.push(unresolvedTrackDiagnostic(command));
      }
    }
    return {
      ...this.base(block),
      kind: 'Bar',
      number: block.number,
      commands
    };
  }

  private buildTrackCommand(statement: ast.TrackStatement): TrackCommand {
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

  private appendReservedDiagnostic(statement: ast.ReservedStatement): void {
    const command = ast.isReservedGlobalStatement(statement)
      ? statement.command
      : statement.command;
    const feature = reservedFeature(command);
    this.diagnostics.push(
      deferredDiagnostic(
        `reserved-${feature.replace('.', '-')}`,
        reservedMessage(feature),
        rangeOf(statement)
      )
    );
  }

  private stringValue(value: string, node: AstNode): StringValue {
    return {
      ...this.base(node),
      kind: 'String',
      value: unquoteString(value)
    };
  }

  private aldaSnippet(value: ast.AldaValue | undefined): AldaSnippet {
    return {
      ...this.base(value),
      kind: 'Alda',
      raw: stripAldaWrapper(value?.raw ?? '')
    };
  }

  private base(node: AstNode | undefined): GasNode {
    return {
      kind: 'Node',
      range: rangeOf(node),
      sourceOrder: this.sourceOrder++
    };
  }
}

function unresolvedTrackDiagnostic(command: TrackCommand): GasDiagnostic {
  return semanticDiagnostic(
    'unresolved-track',
    'error',
    `I cannot find a track named '${command.trackName}' for this command.`,
    command.range
  );
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
    return 'Lyrics are reserved for after v1; Lyria realtime v1 does not render lyrics yet.';
  }
  if (feature === 'effect') {
    return 'Effects are reserved for after v1; describe the sound with flavor for now.';
  }
  if (feature === 'extend') {
    return 'Renderer extension syntax is reserved for after v1.';
  }
  return 'Direct model prompts are reserved for after v1; use GAS intent like flavor and timbre instead.';
}

function stripAldaWrapper(raw: string): string {
  return raw.startsWith('alda(') && raw.endsWith(')') ? raw.slice(5, -1) : raw;
}

function unquoteString(raw: string): string {
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

function rangeOf(node: AstNode | undefined): GasSourceRange {
  return node?.$cstNode?.range ?? fallbackRange;
}
