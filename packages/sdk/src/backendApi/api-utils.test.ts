/**
 * Unit tests for the shared HTTP helpers in `api-utils.ts`.
 *
 * `makeRequest` is the single low-level fetch primitive used by every backend
 * client (`BackendApiService`, `SwapsApiService`). These tests exercise it
 * DIRECTLY (not through a service) so that all of its invariants — URL
 * resolution, header/timeout precedence, method/body forwarding, and the three
 * throw paths — are pinned at their source. The service-level tests
 * (`BackendApiService.test.ts`, `SwapsApiService.test.ts`) cover how each
 * service's private `request` wrapper folds config + wraps the outcome in
 * `Result<T>`; the generic plumbing invariants live here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BACKEND_API_TIMEOUT, type SodaxLogger } from '@sodax/types';
import {
  BackendHttpError,
  isBackendHttpError,
  makeRequest,
  type RequestConfig,
  type RequestOverrideConfig,
} from './api-utils.js';
import { silentLogger } from '../shared/logger.js';

// --- fetch stub -----------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BASE = 'https://api.example.com';

// --- helpers --------------------------------------------------------------
const okResponse = <T>(data: T) => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue(data) });
const httpErrorResponse = (status: number, text: string) => ({
  ok: false,
  status,
  text: vi.fn().mockResolvedValue(text),
});
const abortFetchImpl = (_url: string, init: { signal: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
const stallUntilAbort = <T>(signal: AbortSignal | null | undefined): Promise<T> =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
/** Resolve to the thrown error instead of rejecting, so it can be inspected. */
const caught = (p: Promise<unknown>): Promise<unknown> => p.then(v => v).catch(e => e);
/** The `init` object passed to the most recent fetch call. */
const lastInit = () => mockFetch.mock.calls.at(-1)?.[1] as RequestInit;
/**
 * Thin adapter for the tests: `makeRequest` takes a single `MakeRequestParams` object with a
 * required `logger` and `serviceLabel`. Every test still exercises `makeRequest` directly — this
 * folds in the (required) silent logger so the error-path tests stay quiet, plus a fixed label.
 */
const run = <T>(endpoint: string, config: RequestConfig, overrideConfig?: RequestOverrideConfig): Promise<T> =>
  makeRequest<T>({ endpoint, config, overrideConfig, logger: silentLogger, serviceLabel: 'TestService' });

beforeEach(() => mockFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

// =========================================================================
// makeRequest — URL / baseURL resolution
// =========================================================================

describe('makeRequest URL resolution', () => {
  it('builds the URL from config.baseURL + endpoint when no override is given', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE });
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/foo`, expect.objectContaining({ method: 'GET' }));
  });

  it('overrideConfig.baseURL takes precedence over config.baseURL', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE }, { baseURL: 'https://override.example.com' });
    expect(mockFetch).toHaveBeenCalledWith('https://override.example.com/foo', expect.any(Object));
  });

  it('treats an empty-string override baseURL as "not provided" and falls back to config.baseURL (truthy)', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE }, { baseURL: '' });
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/foo`, expect.any(Object));
  });

  it('produces a relative URL (endpoint only) when neither override nor config supply a baseURL', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET' });
    expect(mockFetch).toHaveBeenCalledWith('/foo', expect.any(Object));
  });

  it.each([
    [`${BASE}/`, `${BASE}/foo`],
    [`${BASE}///`, `${BASE}/foo`],
    [`${BASE}/v1/`, `${BASE}/v1/foo`],
  ])('trims trailing slashes off %s', async (baseURL, expected) => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL });
    expect(mockFetch).toHaveBeenCalledWith(expected, expect.any(Object));
  });

  it('trims trailing slashes off an override baseURL too', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE }, { baseURL: 'https://override.example.com/v1/' });
    expect(mockFetch).toHaveBeenCalledWith('https://override.example.com/v1/foo', expect.any(Object));
  });
});

// =========================================================================
// makeRequest — header merging
// =========================================================================

describe('makeRequest header merging', () => {
  it('merges config.headers with overrideConfig.headers', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run(
      '/foo',
      { method: 'GET', baseURL: BASE, headers: { Accept: 'application/json' } },
      { headers: { 'X-Custom': 'v' } },
    );
    expect(lastInit().headers).toEqual({ Accept: 'application/json', 'X-Custom': 'v' });
  });

  it('overrideConfig.headers take precedence per key', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run(
      '/foo',
      { method: 'GET', baseURL: BASE, headers: { Accept: 'application/json' } },
      { headers: { Accept: 'text/plain' } },
    );
    expect(lastInit().headers).toEqual({ Accept: 'text/plain' });
  });

  it('defaults to an empty headers object when none are supplied', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE });
    expect(lastInit().headers).toEqual({});
  });
});

// =========================================================================
// makeRequest — timeout resolution (asserted via the setTimeout delay)
// =========================================================================

describe('makeRequest timeout resolution', () => {
  it('uses config.timeout when no override is given', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE, timeout: 1234 });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234);
  });

  it('overrideConfig.timeout takes precedence over config.timeout', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE, timeout: 1234 }, { timeout: 50 });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 50);
  });

  it('falls back to DEFAULT_BACKEND_API_TIMEOUT when neither supplies a timeout', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), DEFAULT_BACKEND_API_TIMEOUT);
  });

  it('clears the timeout after a successful response', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE });
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});

// =========================================================================
// makeRequest — method / body / signal forwarding
// =========================================================================

describe('makeRequest request forwarding', () => {
  it('forwards the HTTP method and an AbortSignal', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE });
    const init = lastInit();
    expect(init.method).toBe('GET');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('forwards a POST body verbatim', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'POST', baseURL: BASE, body: '{"x":1}' });
    const init = lastInit();
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"x":1}');
  });

  it('sends no body when none is provided', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE });
    expect(lastInit().body).toBeUndefined();
  });

  it('defaults overrideConfig to {} when overrideConfig is omitted', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ ok: true }));
    const result = await run<{ ok: boolean }>('/foo', { method: 'GET', baseURL: BASE });
    expect(result).toEqual({ ok: true });
  });
});

// =========================================================================
// makeRequest — success
// =========================================================================

describe('makeRequest success', () => {
  it('returns the parsed JSON body', async () => {
    const body = { hello: 'world', n: 1 };
    mockFetch.mockResolvedValueOnce(okResponse(body));
    const result = await run<typeof body>('/foo', { method: 'GET', baseURL: BASE });
    expect(result).toEqual(body);
  });

  it('times out when response headers arrive but the success body stalls', async () => {
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => stallUntilAbort(init.signal),
      }),
    );

    const err = (await caught(run('/foo', { method: 'GET', baseURL: BASE, timeout: 5 }))) as Error;

    expect(err.message).toBe('REQUEST_TIMEOUT');
    expect((err.cause as Error).message).toBe('Request timeout after 5ms');
  });
});

// =========================================================================
// makeRequest — error paths
// =========================================================================

describe('makeRequest error handling', () => {
  it('throws HTTP_REQUEST_FAILED with the status + text as cause on a non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce(httpErrorResponse(500, 'Internal Server Error'));
    const err = (await caught(run('/foo', { method: 'GET', baseURL: BASE }))) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('HTTP_REQUEST_FAILED');
    expect((err.cause as Error).message).toMatch(/HTTP 500: Internal Server Error/);
  });

  it('throws REQUEST_TIMEOUT with the elapsed timeout as cause when aborted by the timeout', async () => {
    mockFetch.mockImplementationOnce(abortFetchImpl);
    const err = (await caught(run('/foo', { method: 'GET', baseURL: BASE, timeout: 5 }))) as Error;
    expect(err.message).toBe('REQUEST_TIMEOUT');
    expect((err.cause as Error).message).toMatch(/Request timeout after 5ms/);
  });

  it('times out when error response headers arrive but the error body stalls', async () => {
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: false,
        status: 503,
        text: () => stallUntilAbort(init.signal),
      }),
    );

    const err = (await caught(run('/foo', { method: 'GET', baseURL: BASE, timeout: 5 }))) as Error;

    expect(err.message).toBe('REQUEST_TIMEOUT');
    expect((err.cause as Error).message).toBe('Request timeout after 5ms');
  });

  it('re-throws a non-abort Error verbatim (e.g. a network failure)', async () => {
    const networkError = new Error('Network down');
    mockFetch.mockRejectedValueOnce(networkError);
    const err = await caught(run('/foo', { method: 'GET', baseURL: BASE }));
    expect(err).toBe(networkError);
  });

  it('throws UNKNOWN_REQUEST_ERROR wrapping a non-Error rejection value', async () => {
    mockFetch.mockRejectedValueOnce('string-not-error');
    const err = (await caught(run('/foo', { method: 'GET', baseURL: BASE }))) as Error;
    expect(err.message).toBe('UNKNOWN_REQUEST_ERROR');
    expect(err.cause).toBe('string-not-error');
  });

  it('clears the timeout on the error path', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockFetch.mockResolvedValueOnce(httpErrorResponse(404, 'Not Found'));
    await caught(run('/foo', { method: 'GET', baseURL: BASE }));
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('prefixes error logs with the caller-provided serviceLabel (not a hardcoded service name)', async () => {
    const logger: SodaxLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    mockFetch.mockRejectedValueOnce(new Error('Network down'));
    await caught(
      makeRequest({
        endpoint: '/foo',
        config: { method: 'GET', baseURL: BASE },
        logger,
        serviceLabel: 'SwapsApiService',
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[SwapsApiService]'), expect.any(Error));
  });
});

describe('BackendHttpError', () => {
  it('exposes the status and the parsed body so callers need not regex the cause message', async () => {
    const body = { statusCode: 409, error: 'SPONSOR_SEQUENCE_CONFLICT', message: 'sequence conflict' };
    mockFetch.mockResolvedValueOnce(httpErrorResponse(409, JSON.stringify(body)));

    const err = (await caught(run('/foo', { method: 'GET', baseURL: BASE }))) as BackendHttpError;

    expect(err).toBeInstanceOf(BackendHttpError);
    expect(err.status).toBe(409);
    expect(err.body).toEqual(body);
    expect(err.bodyText).toBe(JSON.stringify(body));
  });

  it('keeps the legacy message and cause chain byte-identical, so existing callers are unaffected', () => {
    const err = new BackendHttpError(500, 'Internal Server Error');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('HTTP_REQUEST_FAILED');
    expect((err.cause as Error).message).toBe('HTTP 500: Internal Server Error');
  });

  it('leaves `body` undefined for a non-JSON payload rather than throwing', () => {
    const err = new BackendHttpError(502, '<html>Bad Gateway</html>');
    expect(err.body).toBeUndefined();
    expect(err.bodyText).toBe('<html>Bad Gateway</html>');
  });

  it('leaves `body` undefined for an empty payload', () => {
    expect(new BackendHttpError(204, '').body).toBeUndefined();
  });
});

describe('isBackendHttpError', () => {
  it('recognises a real instance', () => {
    expect(isBackendHttpError(new BackendHttpError(500, 'boom'))).toBe(true);
  });

  it('recognises a structurally-identical error from ANOTHER bundled copy of the SDK', () => {
    class ForeignBackendHttpError extends Error {
      readonly status = 503;
      constructor() {
        super('HTTP_REQUEST_FAILED');
        this.name = 'BackendHttpError';
      }
    }
    const foreign = new ForeignBackendHttpError();
    expect(foreign instanceof BackendHttpError).toBe(false);
    expect(isBackendHttpError(foreign)).toBe(true);
  });

  it.each([
    ['a plain Error with the same message', new Error('HTTP_REQUEST_FAILED')],
    ['a same-named error without a numeric status', Object.assign(new Error('x'), { name: 'BackendHttpError' })],
    ['a bare object', { name: 'BackendHttpError', status: 500 }],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isBackendHttpError(value)).toBe(false);
  });
});
