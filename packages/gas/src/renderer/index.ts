// Turns a loaded document into one connection per Play. Internal to the session:
// the api builds it, and nothing outside packages/gas sees it. Contains no GAS
// syntax parsing and depends on no specific connector.

export type { RendererErrorCode, RendererProblem } from './errors.js';
export { RendererError, classifyConnectorFailure } from './errors.js';
export type { CreateRendererOptions } from './renderer.js';
export { createRenderer } from './renderer.js';
export type {
  Renderer,
  RendererEnd,
  RendererEventMap,
  RendererFailure,
  RendererUpdateResult,
  RendererWarning
} from './types.js';
export { SystemClock } from './clock.js';
export type { AudioAccounting } from './audio.js';
export { applyS16leGain, BufferLedger } from './audio.js';
export * from './constants.js';
