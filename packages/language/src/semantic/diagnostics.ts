import type { GasSourceRange } from './ast.js';

export type GasDiagnosticSeverity = 'error' | 'warning' | 'info';

export type GasDiagnosticCategory = 'syntax' | 'semantic' | 'deferred' | 'informational';

export interface GasDiagnostic {
  readonly code: string;
  readonly category: GasDiagnosticCategory;
  readonly severity: GasDiagnosticSeverity;
  readonly message: string;
  readonly range?: GasSourceRange;
}

export function semanticDiagnostic(
  code: string,
  severity: Exclude<GasDiagnosticSeverity, 'info'>,
  message: string,
  range?: GasSourceRange
): GasDiagnostic {
  return { code, category: 'semantic', severity, message, range };
}

export function deferredDiagnostic(
  code: string,
  message: string,
  range?: GasSourceRange
): GasDiagnostic {
  return { code, category: 'deferred', severity: 'error', message, range };
}

export function informationalDiagnostic(
  code: string,
  message: string,
  range?: GasSourceRange
): GasDiagnostic {
  return { code, category: 'informational', severity: 'info', message, range };
}
