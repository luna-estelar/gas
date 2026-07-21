// GAS parsing and language services. Public values are independent of Langium types.

import { EmptyFileSystem } from 'langium';
import { createGasServices } from './gas-module.js';
import { compileDocument } from './compiler/compile.js';
import { isModel, type Model } from './generated/ast.js';
import type { GasDocument } from './semantic/ast.js';
import { buildDocument } from './semantic/build.js';
import type { GasDiagnostic, GasDiagnosticSeverity } from './semantic/diagnostics.js';
import { buildLiveCommands, type LiveStatement } from './semantic/live.js';
import type { Timeline } from './compiler/timeline.js';
import { validate } from './semantic/validate.js';

export type {
  AldaSnippet,
  Bar,
  FlavorCommand,
  FlavorGlobal,
  GasDocument,
  GasNode,
  GasSourcePosition,
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
  TrackCommand,
  TrackCommandBase
} from './semantic/ast.js';
export type {
  GasDiagnostic,
  GasDiagnosticCategory,
  GasDiagnosticSeverity
} from './semantic/diagnostics.js';
export type { LiveStatement, LiveTempoCommand, LiveTrackDeclaration } from './semantic/live.js';
export type {
  ArrangementInstance,
  AldaValue,
  BeatOffset,
  BeatPosition,
  FinitePlayback,
  FormatVersion,
  GlobalDefaults,
  InfinitePlayback,
  IntentValue,
  LevelValue,
  LoopPlayback,
  MusicalContext,
  MusicalPosition,
  Playback,
  PlayStopEvent,
  Provenance,
  Resource,
  ResourceManifest,
  ResourceValue,
  SectionFlavorEvent,
  Sha256Digest,
  SourceIdentity,
  SourcePosition,
  SourceRange,
  TextValue,
  Timeline,
  TimelineEvent,
  TimeSignature,
  TrackDeclaration,
  TrackDefault,
  TrackDefaultAction,
  ValuedTrackAction,
  ValuedTrackEvent
} from './compiler/timeline.js';

export { highlightSource } from './highlight.js';
export type {
  HighlightKind,
  HighlightResult,
  HighlightToken,
  SymbolOccurrence
} from './highlight.js';

// Deterministic name slug, shared with hosts (the GAS API) so live-declared
// tracks get ids consistent with the compiler's authored `track.<slug>`
// scheme. A pure string helper; it adds no dependency. Uniqueness across the
// namespace stays Core's job (`defineTrack` rejects a duplicate id).
export { slugify } from './compiler/ids.js';

export const packageName = '@luna-estelar/gas-language';
export const version = '0.1.0';

export type GasParseDiagnostic = GasDiagnostic;

export interface GasParseSuccess {
  readonly ok: true;
  readonly diagnostics: readonly GasParseDiagnostic[];
}

export interface GasParseFailure {
  readonly ok: false;
  readonly diagnostics: readonly GasParseDiagnostic[];
}

export type GasParseResult = GasParseSuccess | GasParseFailure;

export interface ParseGasDocumentOptions {
  readonly uri?: string;
}

export function parseGasDocument(
  source: string,
  _options: ParseGasDocumentOptions = {}
): GasParseResult {
  const { diagnostics } = parseSyntax(source);
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

export interface AnalyzeGasDocumentOptions extends ParseGasDocumentOptions {}

export interface GasAnalyzeSuccess {
  readonly ok: true;
  readonly document: GasDocument;
  readonly diagnostics: readonly GasDiagnostic[];
}

export interface GasAnalyzeFailure {
  readonly ok: false;
  readonly document?: GasDocument;
  readonly diagnostics: readonly GasDiagnostic[];
}

export type GasAnalyzeResult = GasAnalyzeSuccess | GasAnalyzeFailure;

export function analyzeGasDocument(
  source: string,
  _options: AnalyzeGasDocumentOptions = {}
): GasAnalyzeResult {
  const parsed = parseSyntax(source);
  if (
    parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ||
    parsed.model === undefined
  ) {
    return { ok: false, diagnostics: parsed.diagnostics };
  }

  const built = buildDocument(parsed.model);
  const diagnostics = [...parsed.diagnostics, ...built.diagnostics, ...validate(built.document)];
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? { ok: false, document: built.document, diagnostics }
    : { ok: true, document: built.document, diagnostics };
}

export interface ParseLiveCommandsOptions extends ParseGasDocumentOptions {}

export interface LiveCommandSuccess {
  readonly ok: true;
  readonly statements: readonly LiveStatement[];
  readonly diagnostics: readonly GasDiagnostic[];
}

export interface LiveCommandFailure {
  readonly ok: false;
  readonly statements?: undefined;
  readonly diagnostics: readonly GasDiagnostic[];
}

export type LiveCommandResult = LiveCommandSuccess | LiveCommandFailure;

/**
 * Parses a live GAS fragment (track declarations, track commands, `tempo N`) into an
 * ordered statement list. Any structural syntax error, or any live-only exclusion
 * (sections, arrangement calls, non-tempo globals, reserved keywords), fails the whole
 * parse — there is no partial statement list on failure. Track names are not resolved
 * here; Core resolves live statements against the running session's namespace.
 */
export function parseLiveCommands(
  source: string,
  _options: ParseLiveCommandsOptions = {}
): LiveCommandResult {
  const parsed = parseSyntax(source);
  if (
    parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ||
    parsed.model === undefined
  ) {
    return { ok: false, diagnostics: parsed.diagnostics };
  }

  const built = buildLiveCommands(parsed.model);
  const diagnostics = [...parsed.diagnostics, ...built.diagnostics];
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? { ok: false, diagnostics }
    : { ok: true, statements: built.statements, diagnostics };
}

export interface CompileSourceOptions extends ParseGasDocumentOptions {
  /** Source identity label recorded on the timeline (e.g. a file path). */
  readonly name?: string;
  /** Override the generated timeline id (defaults to a stable constant). */
  readonly timelineId?: string;
}

export interface GasCompileSuccess {
  readonly ok: true;
  readonly timeline: Timeline;
  readonly diagnostics: readonly GasDiagnostic[];
}

export interface GasCompileFailure {
  readonly ok: false;
  readonly timeline?: undefined;
  readonly diagnostics: readonly GasDiagnostic[];
}

export type GasCompileResult = GasCompileSuccess | GasCompileFailure;

export function compileSource(
  source: string,
  options: CompileSourceOptions = {}
): GasCompileResult {
  const parsed = parseSyntax(source);
  if (
    parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ||
    parsed.model === undefined
  ) {
    return { ok: false, diagnostics: parsed.diagnostics };
  }

  const built = buildDocument(parsed.model);
  const analysis = [...parsed.diagnostics, ...built.diagnostics, ...validate(built.document)];
  if (analysis.some((diagnostic) => diagnostic.severity === 'error')) {
    return { ok: false, diagnostics: analysis };
  }

  const compiled = compileDocument(built.document, source, {
    name: options.name,
    timelineId: options.timelineId
  });
  const diagnostics = [...analysis, ...compiled.diagnostics];
  if (
    compiled.timeline === undefined ||
    diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  ) {
    return { ok: false, diagnostics };
  }
  return { ok: true, timeline: compiled.timeline, diagnostics };
}

function parseSyntax(source: string): {
  readonly model?: Model;
  readonly diagnostics: readonly GasDiagnostic[];
} {
  const result = getParser().parse(source);
  const diagnostics = [
    ...result.lexerErrors.map((error) => ({
      code: 'syntax-lexer-error',
      category: 'syntax' as const,
      severity: 'error' as const,
      message: error.message,
      range: rangeFromOffset(source, error.offset, error.length ?? 1, error.line, error.column)
    })),
    ...(result.lexerReport?.diagnostics ?? []).map((diagnostic) => ({
      code: 'syntax-lexer-diagnostic',
      category: 'syntax' as const,
      severity: toPublicSeverity(diagnostic.severity ?? 'error'),
      message: diagnostic.message,
      range: rangeFromOffset(
        source,
        diagnostic.offset,
        diagnostic.length,
        diagnostic.line,
        diagnostic.column
      )
    })),
    ...result.parserErrors.map((error) => ({
      code: 'syntax-parser-error',
      category: 'syntax' as const,
      severity: 'error' as const,
      message: error.message,
      range: rangeFromToken(error.token)
    }))
  ];

  return { model: isModel(result.value) ? result.value : undefined, diagnostics };
}

function getParser() {
  return getServices().Gas.parser.LangiumParser;
}

let services: ReturnType<typeof createGasServices> | undefined;

function getServices(): NonNullable<typeof services> {
  if (services === undefined) {
    services = createGasServices(EmptyFileSystem);
  }
  return services;
}

function toPublicSeverity(severity: string): GasDiagnosticSeverity {
  if (severity === 'warning') {
    return 'warning';
  }
  return severity === 'info' ? 'info' : 'error';
}

function rangeFromToken(token: {
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}): GasDiagnostic['range'] | undefined {
  if (token.startLine === undefined || token.startColumn === undefined) {
    return undefined;
  }
  const start = { line: token.startLine - 1, character: token.startColumn - 1 };
  return {
    start,
    end:
      token.endLine === undefined || token.endColumn === undefined
        ? start
        : { line: token.endLine - 1, character: token.endColumn }
  };
}

function rangeFromOffset(
  source: string,
  offset: number,
  length: number,
  fallbackLine?: number,
  fallbackColumn?: number
): NonNullable<GasDiagnostic['range']> {
  const start =
    fallbackLine === undefined || fallbackColumn === undefined
      ? positionAt(source, offset)
      : { line: fallbackLine - 1, character: fallbackColumn - 1 };
  return {
    start,
    end: positionAt(source, offset + Math.max(length, 0))
  };
}

function positionAt(source: string, offset: number): NonNullable<GasDiagnostic['range']>['start'] {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 0;
  let character = 0;
  for (let index = 0; index < clamped; index++) {
    const char = source.charAt(index);
    if (char === '\n') {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}
