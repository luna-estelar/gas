// Magenta RealTime 2 through a bridge process. Imports GAS's protocol alone.

export const version = '0.3.0';

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
  MAGENTA_RT2_CAPABILITIES,
  MAGENTA_RT2_DESCRIPTION
} from './connector.js';
export type { MagentaRt2Translate, MagentaRt2WarningCode } from './connection.js';
export type { MagentaRt2ConnectorOptions } from './settings.js';

export { classifyClose, openMagentaRt2Session } from './transport.js';
export type {
  BridgeSocket,
  MagentaRt2Generation,
  MagentaRt2Session,
  MagentaRt2SessionOptions
} from './transport.js';
