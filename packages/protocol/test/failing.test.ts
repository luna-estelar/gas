import { describe, expect, it } from 'vitest';
import type { ConnectorFailureReason } from '../src/index.js';
import { ConnectorError } from '../src/index.js';

describe('ConnectorError', () => {
  it('carries the safe structured fields and derives a generic message', () => {
    const error = new ConnectorError({ code: 'x-quota', reason: 'quota', retryable: false });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConnectorError');
    expect(error.code).toBe('x-quota');
    expect(error.reason).toBe('quota');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('The connector reported a quota failure.');
  });

  it('derives a fixed message per reason', () => {
    const messages: Record<ConnectorFailureReason, string> = {
      network: 'The connector reported a network failure.',
      auth: 'The connector reported an authentication failure.',
      quota: 'The connector reported a quota failure.',
      provider: 'The connector reported a provider failure.',
      internal: 'The connector reported an internal failure.'
    };
    for (const reason of Object.keys(messages) as ConnectorFailureReason[]) {
      expect(new ConnectorError({ code: 'x', reason, retryable: true }).message).toBe(
        messages[reason]
      );
    }
  });

  it('derives the message independently of the code and exposes only safe fields', () => {
    const error = new ConnectorError({
      code: 'provider-detail-42',
      reason: 'auth',
      retryable: false
    });
    // The generic message never embeds the caller-supplied code text.
    expect(error.message).toBe('The connector reported an authentication failure.');
    expect(error.message).not.toContain('provider-detail-42');
    // Only the safe structured fields are enumerable; the message stays off the wire.
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: 'ConnectorError',
      code: 'provider-detail-42',
      reason: 'auth',
      retryable: false
    });
  });

  it('normalizes an unknown reason from untyped callers to internal', () => {
    const error = new ConnectorError({
      code: 'x',
      reason: 'weird' as ConnectorFailureReason,
      retryable: true
    });
    expect(error.reason).toBe('internal');
    expect(error.message).toBe('The connector reported an internal failure.');
  });

  it('recognizes a real ConnectorError instance', () => {
    const error = new ConnectorError({ code: 'x', reason: 'network', retryable: true });
    expect(ConnectorError.isConnectorError(error)).toBe(true);
  });

  it('recognizes a foreign Error with a matching name and field types', () => {
    const foreign = new Error('provider failure');
    foreign.name = 'ConnectorError';
    Object.assign(foreign, { code: 'x-provider', reason: 'provider', retryable: false });
    expect(ConnectorError.isConnectorError(foreign)).toBe(true);
  });

  it('rejects lookalikes with wrong field types or shapes', () => {
    const wrongCode = new Error('boom');
    wrongCode.name = 'ConnectorError';
    Object.assign(wrongCode, { code: 42, reason: 'network', retryable: true });
    expect(ConnectorError.isConnectorError(wrongCode)).toBe(false);

    const wrongReason = new Error('boom');
    wrongReason.name = 'ConnectorError';
    Object.assign(wrongReason, { code: 'x', reason: 'weird', retryable: true });
    expect(ConnectorError.isConnectorError(wrongReason)).toBe(false);

    const missingRetryable = new Error('boom');
    missingRetryable.name = 'ConnectorError';
    Object.assign(missingRetryable, { code: 'x', reason: 'network' });
    expect(ConnectorError.isConnectorError(missingRetryable)).toBe(false);

    expect(ConnectorError.isConnectorError(new Error('plain'))).toBe(false);
    expect(ConnectorError.isConnectorError('a string')).toBe(false);
    expect(ConnectorError.isConnectorError({ code: 'x', reason: 'network', retryable: true })).toBe(
      false
    );
    expect(ConnectorError.isConnectorError(null)).toBe(false);
  });
});
