import { IndentationAwareLexer, inject, type Module } from 'langium';
import {
  createDefaultModule,
  createDefaultSharedModule,
  type DefaultSharedModuleContext,
  type LangiumServices,
  type LangiumSharedServices,
  type PartialLangiumServices
} from 'langium/lsp';
import { GasGeneratedModule, GasGeneratedSharedModule } from './generated/module.js';
import { GasTokenBuilder } from './gas-token-builder.js';

export interface GasAddedServices {}

export type GasServices = LangiumServices & GasAddedServices;

export const GasModule: Module<GasServices, PartialLangiumServices & GasAddedServices> = {
  parser: {
    TokenBuilder: () => new GasTokenBuilder(),
    Lexer: (services) => new IndentationAwareLexer(services)
  }
};

export function createGasServices(context: DefaultSharedModuleContext): {
  shared: LangiumSharedServices;
  Gas: GasServices;
} {
  const shared = inject(createDefaultSharedModule(context), GasGeneratedSharedModule);
  const Gas = inject(createDefaultModule({ shared }), GasGeneratedModule, GasModule);
  shared.ServiceRegistry.register(Gas);
  if (!context.connection) {
    shared.workspace.ConfigurationProvider.initialized({});
  }
  return { shared, Gas };
}
