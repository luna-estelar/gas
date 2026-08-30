// Compilation loads gas-language and its parser dependencies. Import this subpath
// dynamically when compilation is optional. timeline.ts and inspect.ts operate on
// compiled timelines without loading the parser.
import {
  compileSource,
  highlightSource,
  parseLiveCommands,
  type GasDiagnostic,
  type HighlightToken,
  type LiveStatement,
  type SymbolOccurrence
} from '@luna-estelar/gas-language';
import type { Timeline } from '@luna-estelar/gas-protocol';

export type Diagnostic = GasDiagnostic;
export type EditorToken = HighlightToken;
export type EditorSymbol = SymbolOccurrence;
export type CompiledTimeline = Timeline;

// Inspection moved to ./inspect.js so it can be used without the compiler; it is
// re-exported here because this module is the host's front door.
export { inspectTimeline } from './inspect.js';
export type { EffectiveSnapshot, Inspection } from './inspect.js';

export interface CompileSnapshot {
  readonly ok: boolean;
  readonly timeline?: CompiledTimeline;
  readonly diagnostics: readonly Diagnostic[];
  readonly tokens: readonly EditorToken[];
  readonly symbols: readonly EditorSymbol[];
}

export function compileGas(source: string, name: string): CompileSnapshot {
  const result = compileSource(source, { name });
  const highlight = highlightSource(source);
  return {
    ok: result.ok,
    timeline: result.ok ? result.timeline : undefined,
    diagnostics: result.diagnostics,
    tokens: highlight.tokens,
    symbols: highlight.symbols
  };
}

/** Highlight source fragments without semantic validation. */
export function highlightGas(source: string): readonly EditorToken[] {
  return highlightSource(source).tokens;
}

/** Hold the last timeline that compiled, so a failing edit does not blank the view. */
export function retainTimeline(
  previous: CompiledTimeline | null,
  next: CompileSnapshot
): CompiledTimeline | null {
  return next.timeline ?? previous;
}

/** Parsed live statement with its kind and target available to UI consumers. */
export interface LiveStatementView {
  readonly label: string;
  readonly kind: LiveStatement['kind'];
  /** The track the statement addresses. Absent for `tempo`. */
  readonly trackName?: string;
}

export type LivePreview =
  | { readonly status: 'empty' }
  | { readonly status: 'valid'; readonly statements: readonly LiveStatementView[] }
  | { readonly status: 'invalid'; readonly message: string };

export function previewLiveCommands(source: string): LivePreview {
  if (source.trim() === '') return { status: 'empty' };
  const result = parseLiveCommands(source);
  if (!result.ok) {
    return {
      status: 'invalid',
      message: result.diagnostics[0]?.message ?? 'Invalid live command.'
    };
  }
  return { status: 'valid', statements: result.statements.map(describeLiveStatement) };
}

export function describeLiveStatement(statement: LiveStatement): LiveStatementView {
  return {
    label: labelLiveStatement(statement),
    kind: statement.kind,
    trackName:
      statement.kind === 'Tempo'
        ? undefined
        : statement.kind === 'DeclareTrack'
          ? statement.name
          : statement.trackName
  };
}

export function labelLiveStatement(statement: LiveStatement): string {
  switch (statement.kind) {
    case 'DeclareTrack':
      return `declare track ${statement.name}`;
    case 'Tempo':
      return `tempo ${statement.bpm}`;
    case 'Play':
      return `${statement.trackName}.play`;
    case 'Stop':
      return `${statement.trackName}.stop`;
    case 'Flavor':
      return `${statement.trackName}.flavor`;
    case 'Timbre':
      return `${statement.trackName}.timbre`;
    case 'Level':
      return `${statement.trackName}.level ${statement.value}`;
    case 'Notes':
      return `${statement.trackName}.notes`;
    case 'Motif':
      return `${statement.trackName}.motif`;
  }
}
