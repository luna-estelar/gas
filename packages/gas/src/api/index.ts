// The session and its commands, as an app uses them.

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
  OperationErrorInit,
  OperationErrorKind,
  PlayWarning,
  DocumentDefaults,
  GenerationPositionEvent,
  SessionEnded,
  SessionState,
  SessionStatus,
  SessionWarning,
  SubmitLiveCommandsResult,
  TrackView,
  WarningEvent
} from './types.js';
