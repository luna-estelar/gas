// GAS parsing and language services. Public values are independent of Langium types.

import { EmptyFileSystem } from 'langium';
import { createGasServices } from './gas-module.js';

export const packageName = '@luna-estelar/gas-language';
export const version = '0.1.0';

export type GasDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface GasSourcePosition {
  readonly line: number;
  readonly column: number;
}

export interface GasSourceRange {
  readonly start: GasSourcePosition;
  readonly end?: GasSourcePosition;
}

export interface GasParseDiagnostic {
  readonly severity: GasDiagnosticSeverity;
  readonly message: string;
  readonly range?: GasSourceRange;
}

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
  const result = getParser().parse(source);
  const diagnostics = [
    ...result.lexerErrors.map((error) => ({
      severity: 'error' as const,
      message: error.message,
      range: rangeFromOffset(source, error.offset, error.length ?? 1, error.line, error.column)
    })),
    ...(result.lexerReport?.diagnostics ?? []).map((diagnostic) => ({
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
      severity: 'error' as const,
      message: error.message,
      range: rangeFromToken(error.token)
    }))
  ];
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
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
}): GasSourceRange | undefined {
  if (token.startLine === undefined || token.startColumn === undefined) {
    return undefined;
  }
  return {
    start: { line: token.startLine, column: token.startColumn },
    end:
      token.endLine === undefined || token.endColumn === undefined
        ? undefined
        : { line: token.endLine, column: token.endColumn }
  };
}

function rangeFromOffset(
  source: string,
  offset: number,
  length: number,
  fallbackLine?: number,
  fallbackColumn?: number
): GasSourceRange {
  const start =
    fallbackLine === undefined || fallbackColumn === undefined
      ? positionAt(source, offset)
      : { line: fallbackLine, column: fallbackColumn };
  return {
    start,
    end: positionAt(source, offset + Math.max(length, 0))
  };
}

function positionAt(source: string, offset: number): GasSourcePosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let column = 1;
  for (let index = 0; index < clamped; index++) {
    const char = source.charAt(index);
    if (char === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}
