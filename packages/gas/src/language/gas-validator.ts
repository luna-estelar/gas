import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type { GasAstType, Model } from './generated/ast.js';
import type { GasServices } from './gas-module.js';
import { buildDocument } from './semantic/build.js';
import type { GasDiagnostic } from './semantic/diagnostics.js';
import { validate } from './semantic/validate.js';

export function registerValidationChecks(services: GasServices): void {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.GasValidator;
  const checks: ValidationChecks<GasAstType> = {
    Model: validator.checkModel
  };
  registry.register(checks, validator);
}

export class GasValidator {
  checkModel(model: Model, accept: ValidationAcceptor): void {
    const { document, diagnostics } = buildDocument(model);
    for (const diagnostic of [...diagnostics, ...validate(document)]) {
      acceptGasDiagnostic(model, diagnostic, accept);
    }
  }
}

function acceptGasDiagnostic(
  model: Model,
  diagnostic: GasDiagnostic,
  accept: ValidationAcceptor
): void {
  accept(diagnostic.severity, diagnostic.message, {
    node: model,
    code: diagnostic.code,
    range: diagnostic.range
  });
}
