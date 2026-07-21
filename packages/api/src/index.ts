// Application-facing sessions and commands. Renderer implementations arrive through wiring.

export { createSession, GasSession } from './session.js';
export type {
  CompileOptions,
  CompileResult,
  DefineTrackInput,
  RendererControl
} from './session.js';

export type { SessionWiring } from './wiring.js';

export {
  sourceText,
  sourceBytes,
  sourceBlob,
  sourceFile,
  sourceUrl,
  sourcePath
} from './source.js';
export type { SourceInput, ResolvedSource } from './source.js';

export type { LifecycleEvent, DiagnosticEvent, SessionEvent, SessionEventMap } from './events.js';

export { GasOperationError } from './types.js';
export type {
  AppliedPosition,
  CommandResult,
  LiveCommandFailureResult,
  LiveCommandResult,
  LiveCommandSuccess,
  OperationErrorInit,
  OperationErrorKind,
  PlaybackPhase,
  PlaybackWarning,
  SessionState,
  SessionWarning,
  TrackView,
  WarningEvent
} from './types.js';

export const packageName = '@luna-estelar/gas-api';
export const version = '0.1.0';
