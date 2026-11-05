import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_CHECKS,
  ConformanceFailure,
  abortWhileConnecting,
  alreadyAborted,
  connectionsIndependent,
  describeConnector,
  lateConnectionCloses,
  nothingAfterClose,
  pauseStopsGenerating,
  playingFailureReportsOnce,
  startupFailureRejects,
  type ConnectorCheck
} from '../src/index.js';
import { referenceHarness, type Breakage } from './support/reference-connector.js';

describeConnector('the reference connector', () => referenceHarness());

describe('each check fails the connector that breaks it', () => {
  const cases: readonly [string, ConnectorCheck, Breakage, RegExp][] = [
    ['already aborted', alreadyAborted, { opensWhenAborted: true }, /opened 1 transports/],
    ['abort while connecting', abortWhileConnecting, { ignoresAbort: true }, /kept waiting/],
    [
      'late connection',
      lateConnectionCloses,
      { leaksLateTransport: true },
      /provider opened late, 1 transports were open/
    ],
    ['after close', nothingAfterClose, { sendsAfterClose: true }, /2 messages reached/],
    ['plain error', startupFailureRejects, { plainErrors: true }, /not a ConnectorError/],
    [
      'wrong reason',
      startupFailureRejects,
      { wrongReason: true },
      /reason provider.*expected reason auth/
    ],
    ['reported twice', playingFailureReportsOnce, { reportsTwice: true }, /called 2 times/],
    [
      'pause ignored',
      pauseStopsGenerating,
      { pauseDoesNothing: true },
      /still generating after pause/
    ],
    [
      'shared transport',
      connectionsIndependent,
      { sharesTransport: true },
      /0 transports were open; expected 1/
    ]
  ];

  it.each(cases)('%s', async (_name, check, broken, message) => {
    const failure = await check(referenceHarness(broken)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConformanceFailure);
    expect((failure as Error).message).toMatch(message);
  });

  it('covers every check', () => {
    const covered = new Set(cases.map(([, check]) => check));
    expect(Object.values(CONNECTOR_CHECKS).filter((check) => !covered.has(check))).toEqual([]);
  });
});

describe('the harness', () => {
  it.each(['connect', 'playing'] as const)('needs a %s failure', async (when) => {
    const harness = referenceHarness();
    const failure = await (when === 'connect' ? startupFailureRejects : playingFailureReportsOnce)({
      ...harness,
      failures: harness.failures.filter((entry) => entry.when !== when)
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConformanceFailure);
    expect((failure as Error).message).toBe(
      `The harness has no '${when}' failure. Add a failure with when: '${when}'.`
    );
  });
});
