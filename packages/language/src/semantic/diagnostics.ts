import type { GasSourceRange } from './ast.js';
import type { GasDiagnostic, GasDiagnosticSeverity } from '@luna-estelar/gas-protocol';

export type {
  GasDiagnostic,
  GasDiagnosticCategory,
  GasDiagnosticSeverity
} from '@luna-estelar/gas-protocol';

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
