export {
  CONNECTOR_CHECKS,
  ConformanceFailure,
  abortWhileConnecting,
  alreadyAborted,
  connectionsIndependent,
  lateConnectionCloses,
  nothingAfterClose,
  pauseStopsGenerating,
  playingFailureReportsOnce,
  startupFailureRejects
} from './checks.js';
export type { ConnectorCheck } from './checks.js';
export { DEFAULT_STATE, DEFAULT_TIMING } from './harness.js';
export type { ConnectorHarness, CreateHarness, HarnessFailure } from './harness.js';
export { describeConnector } from './vitest.js';
