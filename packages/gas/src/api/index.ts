// Application-facing sessions and commands. The session builds its renderer
// itself; the renderer is internal.

export { createSession, GasSession } from './session.js';
export type {
  CompileOptions,
  CreateSessionOptions,
  LoadOptions,
  CompileResult,
  DefineTrackInput
} from './session.js';

export {
  sourceText,
  sourceBytes,
  sourceBlob,
  sourceFile,
  sourceUrl,
  sourcePath
} from './source.js';
export type { SourceInput, ResolvedSource } from './source.js';

export type { SessionEvent, SessionEventMap } from './events.js';

export { GasOperationError } from './types.js';
export type {
  AppliedPosition,
  CommandResult,
  LoadResult,
  LiveCommandResult,
  LiveCommandSuccess,
  OperationErrorInit,
  OperationErrorKind,
  PlaybackWarning,
  DocumentDefaults,
  GenerationPositionEvent,
  SessionEnded,
  SessionState,
  SessionStatus,
  SessionWarning,
  TrackView,
  WarningEvent
} from './types.js';
