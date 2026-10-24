// Magenta RealTime 2 through a bridge process. Imports GAS's protocol alone.

export const version = '0.1.0';

export {
  DEFAULT_MAGENTA_RT2_CONFIG,
  MAGENTA_RT2_CONFIG_SCHEMA,
  resolveMagentaRt2Config,
  validateMagentaRt2Config
} from './config.js';
export type {
  MagentaRt2ConnectorConfig,
  MagentaRt2GenerationConfig,
  MagentaRt2PromptConfig
} from './config.js';

export { MAX_PROMPT_BYTES, MAX_PROMPTS, translatePrompts } from './prompts.js';
export type { PromptTranslation, WeightedPrompt } from './prompts.js';

export {
  createMagentaRt2Connector,
  createMagentaRt2ConnectorWithDependencies,
  MAGENTA_RT2_CAPABILITIES
} from './connector.js';
export type { BridgeSocket, MagentaRt2ConnectorDependencies } from './connector.js';
export type { MagentaRt2ConnectorSettings } from './settings.js';
