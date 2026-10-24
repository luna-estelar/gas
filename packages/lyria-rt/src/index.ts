// Lyria RealTime prompt translation and transport. Vendor types remain behind the protocol boundary.

export const version = '0.3.0';

export {
  LYRIA_RT_CONFIG_SCHEMA,
  DEFAULT_LYRIA_RT_CONFIG,
  resolveLyriaRtConfig,
  validateLyriaRtConfig
} from './config.js';
export type {
  LyriaRtConnectorConfig,
  LyriaRtGenerationConfig,
  LyriaRtGenerationMode,
  LyriaRtPromptConfig,
  LyriaRtPromptStrategy
} from './config.js';

export { LYRIA_RT_SCALES, classifyKey } from './scale.js';
export type { KeyClassification, LyriaRtScale } from './scale.js';

export { translatePrompts } from './prompts.js';
export type { PromptTranslationOptions, WeightedPrompt } from './prompts.js';

export { createPromptTransition } from './transition.js';
export type { PromptSender, PromptTransition, PromptTransitionOptions } from './transition.js';

export { createLyriaRtConnector, LYRIA_RT_CAPABILITIES } from './connector.js';
export type { LyriaRtConnectorSettings } from './settings.js';
