import { describe, expect, it } from 'vitest';
import { SPONSORING_API_ERROR_CODES } from '@sodax/types';
import { BackendHttpError } from '../backendApi/api-utils.js';
import { SodaxError } from '../errors/SodaxError.js';
import { classifySponsorError, type SponsorFailureAction } from './errors.js';
import { isHorizonNotFound } from './internal/horizon.js';

const wireError = (status: number, body: unknown): SodaxError<'EXTERNAL_API_ERROR'> =>
  new SodaxError('EXTERNAL_API_ERROR', 'HTTP_REQUEST_FAILED', {
    feature: 'backend',
    cause: new BackendHttpError(status, JSON.stringify(body)),
    context: { api: 'sponsoring', endpoint: '/sponsorships/stellar/accounts', status },
  });

describe('classifySponsorError', () => {
  it.each<[string, number, unknown, SponsorFailureAction, boolean, boolean]>([
    [
      'invalid XDR',
      400,
      { statusCode: 400, error: 'INVALID_SPONSOR_XDR', message: 'transaction is not signed by the created account' },
      'fixIntegration',
      false,
      false,
    ],
    [
      'validation pipe (error is a LABEL, not a code)',
      400,
      { statusCode: 400, message: 'data should not be empty', error: 'Bad Request' },
      'fixIntegration',
      false,
      false,
    ],
    [
      'missing api key (error is a LABEL)',
      401,
      { statusCode: 401, message: 'Missing x-api-key', error: 'Unauthorized' },
      'checkApiKey',
      false,
      false,
    ],
    [
      'sequence conflict',
      409,
      {
        statusCode: 409,
        error: 'SPONSOR_SEQUENCE_CONFLICT',
        message: 'sponsor account sequence conflict (tx_bad_seq)',
      },
      'rebuildAndResign',
      true,
      true,
    ],
    [
      'deterministic on-chain rejection',
      422,
      {
        statusCode: 422,
        error: 'SPONSOR_TRANSACTION_REJECTED',
        message: 'Horizon rejected the transaction (tx_too_late)',
      },
      'abort',
      false,
      false,
    ],
    [
      'per-key quota',
      429,
      { statusCode: 429, error: 'SPONSOR_RATE_LIMITED', message: 'per-day rate limit exceeded', retryAfterSeconds: 30 },
      'backoff',
      true,
      false,
    ],
    [
      'per-IP throttle (NO error field at all)',
      429,
      { statusCode: 429, message: 'ThrottlerException: Too Many Requests' },
      'backoff',
      true,
      false,
    ],
    [
      'server reserve fault',
      500,
      { statusCode: 500, error: 'INVALID_RESERVE_DATA', message: 'could not read sponsor reserve' },
      'contactOperator',
      false,
      false,
    ],
    [
      'unexpected server throw (NO error field at all)',
      500,
      { statusCode: 500, message: 'Internal server error' },
      'contactOperator',
      false,
      false,
    ],
    [
      'framework 500 (error is a LABEL)',
      500,
      { statusCode: 500, message: 'sponsor config unavailable', error: 'Internal Server Error' },
      'contactOperator',
      false,
      false,
    ],
    [
      'transient upstream',
      503,
      { statusCode: 503, error: 'HORIZON_UNAVAILABLE', message: 'Horizon is unavailable' },
      'retrySameRequest',
      true,
      false,
    ],
    [
      'sponsor out of budget',
      503,
      {
        statusCode: 503,
        error: 'SPONSOR_BUDGET_EXHAUSTED',
        message: 'sponsor available reserve is below the configured floor',
      },
      'contactOperator',
      false,
      false,
    ],
    [
      'coordinator draining (error is a LABEL)',
      503,
      { statusCode: 503, message: 'sponsor coordinator is draining', error: 'Service Unavailable' },
      'backoff',
      true,
      false,
    ],
    ['unknown status', 418, { statusCode: 418, message: "I'm a teapot" }, 'abort', false, false],
  ])('classifies %s (%i)', (_label, status, body, action, retryable, requiresNewSignature) => {
    const result = classifySponsorError(wireError(status, body));
    expect(result.action).toBe(action);
    expect(result.retryable).toBe(retryable);
    expect(result.requiresNewSignature).toBe(requiresNewSignature);
    expect(result.status).toBe(status);
  });

  it('only ever sets `code` when `error` is a real domain code', () => {
    const domain = classifySponsorError(
      wireError(409, { statusCode: 409, error: 'SPONSOR_SEQUENCE_CONFLICT', message: 'conflict' }),
    );
    expect(domain.code).toBe('SPONSOR_SEQUENCE_CONFLICT');

    // Framework labels are not domain error codes.
    for (const label of ['Unauthorized', 'Bad Request', 'Service Unavailable', 'Internal Server Error']) {
      expect(
        classifySponsorError(wireError(503, { statusCode: 503, message: 'x', error: label })).code,
      ).toBeUndefined();
    }
    expect(classifySponsorError(wireError(429, { statusCode: 429, message: 'x' })).code).toBeUndefined();
  });

  it('surfaces retryAfterSeconds from the BODY on the per-key quota 429', () => {
    // The response body works in browsers without exposing Retry-After through CORS.
    const quota = classifySponsorError(
      wireError(429, { statusCode: 429, error: 'SPONSOR_RATE_LIMITED', message: 'slow down', retryAfterSeconds: 30 }),
    );
    expect(quota.retryAfterSeconds).toBe(30);

    const throttle = classifySponsorError(
      wireError(429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }),
    );
    expect(throttle.retryAfterSeconds).toBeUndefined();
  });

  it.each([
    ['a non-numeric value', 'soon'],
    ['zero', 0],
    ['a negative value', -5],
    ['a non-finite value', Number.POSITIVE_INFINITY],
  ])('ignores %s for retryAfterSeconds rather than passing it on', (_label, value) => {
    const result = classifySponsorError(
      wireError(429, { statusCode: 429, error: 'SPONSOR_RATE_LIMITED', message: 'x', retryAfterSeconds: value }),
    );
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  it('surfaces the server message, falling back to the SDK message when the body has none', () => {
    expect(classifySponsorError(wireError(422, { statusCode: 422, message: 'Horizon rejected it' })).message).toBe(
      'Horizon rejected it',
    );
    expect(classifySponsorError(wireError(422, 'not-an-object')).message).toBe('HTTP_REQUEST_FAILED');
  });

  it('treats a failure with no HTTP status (network / timeout) as retryable backoff', () => {
    const transport = new SodaxError('EXTERNAL_API_ERROR', 'REQUEST_TIMEOUT', {
      feature: 'backend',
      cause: new Error('REQUEST_TIMEOUT'),
      context: { api: 'sponsoring' },
    });
    const result = classifySponsorError(transport);
    expect(result.action).toBe('backoff');
    expect(result.retryable).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('tolerates a non-JSON body (e.g. an HTML 502 from a gateway that never reached the service)', () => {
    const error = new SodaxError('EXTERNAL_API_ERROR', 'HTTP_REQUEST_FAILED', {
      feature: 'backend',
      cause: new BackendHttpError(502, '<html>Bad Gateway</html>'),
      context: { api: 'sponsoring' },
    });
    expect(() => classifySponsorError(error)).not.toThrow();
    expect(classifySponsorError(error).status).toBe(502);
  });

  it('has a defined outcome for every published domain code', () => {
    // Keep the published code union and classifier exhaustive.
    for (const code of SPONSORING_API_ERROR_CODES) {
      const status = code === 'SPONSOR_SEQUENCE_CONFLICT' ? 409 : 503;
      const result = classifySponsorError(wireError(status, { statusCode: status, error: code, message: code }));
      expect(result.action).toBeDefined();
      expect(typeof result.retryable).toBe('boolean');
    }
  });
});

describe('isHorizonNotFound', () => {
  it('recognises a 404 by response status', () => {
    expect(isHorizonNotFound({ response: { status: 404 } })).toBe(true);
  });

  it('does NOT treat a non-404 Horizon failure as "not found"', () => {
    // Stellar's NotFoundError extends NetworkError, so parent-class checks are unsafe.
    expect(isHorizonNotFound({ response: { status: 500 } })).toBe(false);
    expect(isHorizonNotFound({ response: { status: 503 } })).toBe(false);
  });

  it('does not treat a bare Error, null, or undefined as "not found"', () => {
    expect(isHorizonNotFound(new Error('Network down'))).toBe(false);
    expect(isHorizonNotFound(null)).toBe(false);
    expect(isHorizonNotFound(undefined)).toBe(false);
  });
});
