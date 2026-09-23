// Lyria prompt translation and transport. Vendor types remain behind the protocol boundary.

export const packageName = '@luna-estelar/gas-connector-lyria';
export const version = '0.1.1';

export { LYRIA_CONFIG_SCHEMA, DEFAULT_LYRIA_CONFIG, resolveLyriaConfig } from './config.js';
export type {
  LyriaConnectorConfig,
  LyriaGenerationConfig,
  LyriaGenerationMode,
  LyriaPromptConfig,
  LyriaPromptStrategy
} from './config.js';

export { LYRIA_SCALES, classifyKey } from './scale.js';
export type { KeyClassification, LyriaScale } from './scale.js';

export { translatePrompts } from './prompts.js';
export type { PromptTranslationOptions, WeightedPrompt } from './prompts.js';

export { createPromptTransition } from './transition.js';
export type { PromptSender, PromptTransition, PromptTransitionOptions } from './transition.js';

export { createLyriaConnector, LYRIA_CAPABILITIES } from './connector.js';
export type { LyriaConnectorSettings } from './settings.js';
