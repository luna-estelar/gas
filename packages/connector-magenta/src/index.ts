// Magenta RealTime 2 prompt translation and bridge transport. The model runs on
// the listener's machine behind the bridge in `bridge/`; nothing here loads it.

export const version = '0.0.0';

export {
  MAGENTA_CONFIG_SCHEMA,
  DEFAULT_MAGENTA_CONFIG,
  resolveMagentaConfig,
  validateMagentaConfig
} from './config.js';
export type {
  MagentaConnectorConfig,
  MagentaDrumMode,
  MagentaGenerationConfig,
  MagentaPromptConfig,
  MagentaPromptStrategy
} from './config.js';

export { MAGENTA_BRIDGE_PROTOCOL, MAGENTA_DEFAULT_ENDPOINT } from './constants.js';

export { translatePrompts } from './prompts.js';
export type { PromptContext, PromptTranslationOptions, WeightedPrompt } from './prompts.js';

export { selectPitches } from './notes.js';
export type { PitchSelection } from './notes.js';

export { createMagentaConnector, MAGENTA_CAPABILITIES } from './connector.js';
export type { MagentaConnectorSettings } from './settings.js';
