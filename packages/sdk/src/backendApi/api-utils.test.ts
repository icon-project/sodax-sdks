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
 *
 * `toJsonBody` is the bigint-safe request-body serializer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BACKEND_API_TIMEOUT } from '@sodax/types';
import { makeRequest, toJsonBody, type RequestConfig, type RequestOverrideConfig } from './api-utils.js';
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
/** Resolve to the thrown error instead of rejecting, so it can be inspected. */
const caught = (p: Promise<unknown>): Promise<unknown> => p.then(v => v).catch(e => e);
/** The `init` object passed to the most recent fetch call. */
const lastInit = () => mockFetch.mock.calls.at(-1)?.[1] as RequestInit;
/**
 * Thin adapter for the tests: `makeRequest` takes a single `MakeRequestParams` object with a
 * required `logger`. Every test still exercises `makeRequest` directly — this only folds in the
 * (now-required) silent logger so the error-path tests stay quiet.
 */
const run = <T>(endpoint: string, config: RequestConfig, overrideConfig?: RequestOverrideConfig): Promise<T> =>
  makeRequest<T>({ endpoint, config, overrideConfig, logger: silentLogger });

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
});

// =========================================================================
// toJsonBody — bigint-safe serialization
// =========================================================================

describe('toJsonBody', () => {
  it('serializes a top-level bigint to a decimal string', () => {
    expect(toJsonBody(123456789n)).toBe('"123456789"');
  });

  it('serializes bigint object fields to decimal strings', () => {
    expect(toJsonBody({ a: 1n, b: 5000000000000000000n })).toBe('{"a":"1","b":"5000000000000000000"}');
  });

  it('serializes nested bigints inside objects and arrays', () => {
    expect(toJsonBody({ nested: { values: [1n, 2n] } })).toBe('{"nested":{"values":["1","2"]}}');
  });

  it('leaves non-bigint primitives unchanged', () => {
    expect(toJsonBody({ s: 'x', n: 1, b: true, z: null })).toBe('{"s":"x","n":1,"b":true,"z":null}');
  });

  it('preserves precision beyond Number.MAX_SAFE_INTEGER', () => {
    expect(JSON.parse(toJsonBody({ big: 9007199254740993n }))).toEqual({ big: '9007199254740993' });
  });

  it('omits undefined fields (standard JSON.stringify behavior)', () => {
    expect(toJsonBody({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('does not throw on a struct mixing bigint and plain fields', () => {
    const intent = { intentId: 7n, creator: '0xabc', allowPartialFill: false, deadline: 0n };
    expect(() => toJsonBody(intent)).not.toThrow();
    expect(JSON.parse(toJsonBody(intent))).toEqual({
      intentId: '7',
      creator: '0xabc',
      allowPartialFill: false,
      deadline: '0',
    });
  });
});
