// Lyria RealTime prompt translation and transport. Vendor types remain behind the protocol boundary.

export const version = '0.4.0';

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
export type {
  LyriaRtTransitionFactory,
  PromptSender,
  PromptTransition,
  PromptTransitionOptions
} from './transition.js';

export {
  createLyriaRtConnector,
  LYRIA_RT_CAPABILITIES,
  LYRIA_RT_DESCRIPTION
} from './connector.js';
export type { LyriaRtTranslate } from './connection.js';
export type { LyriaRtApiKey, LyriaRtConnectorOptions } from './settings.js';

export { openLyriaRtSession } from './transport.js';
export type {
  LyriaRtMusicGenerationConfig,
  LyriaRtSession,
  LyriaRtSessionOptions,
  LyriaRtTransportWarningCode
} from './transport.js';
