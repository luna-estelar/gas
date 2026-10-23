import * as ast from '../generated/ast.js';
import type {
  Bar,
  FlavorGlobal,
  GasDocument,
  Global,
  GlobalLength,
  Globals,
  KeyGlobal,
  LevelGlobal,
  Section,
  SectionLength,
  SectionPlay,
  TempoGlobal,
  TimeSignatureGlobal,
  Track,
  TrackCommand
} from './ast.js';
import { semanticDiagnostic, type GasDiagnostic } from './diagnostics.js';
import { NodeLowering, reservedDiagnostic, unquoteString } from './lower.js';

export interface BuildResult {
  readonly document: GasDocument;
  readonly diagnostics: readonly GasDiagnostic[];
}

interface TrackRecord {
  readonly track: Track;
  readonly defaults: TrackCommand[];
}

export function buildDocument(model: ast.Model): BuildResult {
  return new SemanticBuilder().build(model);
}

class SemanticBuilder {
  private readonly diagnostics: GasDiagnostic[] = [];
  private readonly lowering = new NodeLowering();

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
        this.diagnostics.push(reservedDiagnostic(element));
      } else if (ast.isTrackDeclaration(element)) {
        const defaults: TrackCommand[] = [];
        const track: Track = {
          ...this.lowering.base(element),
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
        const command = this.lowering.trackCommand(element);
        const record = trackRecords.get(command.trackName);
        if (record !== undefined) {
          record.defaults.push(command);
        } else {
          orphanCommands.push(command);
          this.diagnostics.push(unresolvedTrackDiagnostic(command));
        }
      } else if (ast.isSectionCall(element)) {
        const call: SectionPlay = {
          ...this.lowering.base(element),
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
        ...this.lowering.base(model),
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
      return { ...this.lowering.base(declaration), kind: 'Tempo', bpm: declaration.bpm };
    }
    if (ast.isKeyDeclaration(declaration)) {
      return {
        ...this.lowering.base(declaration),
        kind: 'Key',
        value: unquoteString(declaration.value)
      };
    }
    if (ast.isTimeSignatureDeclaration(declaration)) {
      return {
        ...this.lowering.base(declaration),
        kind: 'TimeSignature',
        numerator: declaration.numerator,
        denominator: declaration.denominator
      };
    }
    if (ast.isGlobalLengthDeclaration(declaration)) {
      return this.buildGlobalLength(declaration);
    }
    if (ast.isLevelDeclaration(declaration)) {
      return { ...this.lowering.base(declaration), kind: 'Level', value: declaration.value };
    }
    return {
      ...this.lowering.base(declaration),
      kind: 'Flavor',
      value: unquoteString(declaration.value)
    };
  }

  private buildGlobalLength(declaration: ast.GlobalLengthDeclaration): GlobalLength {
    const length = declaration.length;
    if (ast.isInfiniteLength(length)) {
      return { ...this.lowering.base(declaration), kind: 'Length', mode: 'infinite' };
    }
    return {
      ...this.lowering.base(declaration),
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
          ...this.lowering.base(item),
          kind: 'SectionLength',
          bars: item.length.bars
        };
      } else if (ast.isFlavorDeclaration(item)) {
        flavors.push({
          ...this.lowering.base(item),
          kind: 'Flavor',
          value: unquoteString(item.value)
        });
      } else if (ast.isReservedStatement(item)) {
        this.diagnostics.push(reservedDiagnostic(item));
      } else if (ast.isTrackStatement(item)) {
        const command = this.lowering.trackCommand(item);
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
      ...this.lowering.base(declaration),
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
        this.diagnostics.push(reservedDiagnostic(statement));
        continue;
      }
      const command = this.lowering.trackCommand(statement);
      commands.push(command);
      if (!tracksByName.has(command.trackName)) {
        orphanCommands.push(command);
        this.diagnostics.push(unresolvedTrackDiagnostic(command));
      }
    }
    return {
      ...this.lowering.base(block),
      kind: 'Bar',
      number: block.number,
      commands
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
