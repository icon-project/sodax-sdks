import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadfiConfig } from '@sodax/types';
import { RadfiApiError, RadfiProvider } from './RadfiProvider.js';

// Regression tests for issue #233: a non-JSON (HTML) Bound Exchange response must surface as a
// typed RadfiApiError carrying the real HTTP status — NOT a raw `SyntaxError: Unexpected token '<'`.
// This guards the BE "build raw intent" path so an SDK bump can't silently regress it.

const baseConfig: RadfiConfig = {
  apiUrl: 'https://api.bound.exchange/api',
  apiKey: '',
  umsUrl: 'https://api.ums.bound.exchange/api',
  accessToken: '',
  refreshToken: '',
};

// The exact gateway body shape from the production report (nginx 403 HTML).
const HTML_403 =
  '<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n</body>\r\n</html>';
const HTML_502 = '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>502</body></html>';

/** Minimal Response stub: `parseJsonBody` reads `res.text()`, then checks `res.ok` / `res.status`. */
function makeResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  } as unknown as Response;
}

const withdrawParams = {
  token: '0:0',
  amount: 1000n,
  recipient: 'bc1pcz4pyrfgv7v6tx8a404mafyvt73cnm80yuv8tqwrywxmqxpja8ys4pjyl5',
  userAddress: 'bc1qnqllgwj499u0q6pyj7syrzpapnsvpcrnkrvead',
  data: 'deadbeef',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RadfiProvider — non-JSON error bodies (issue #233)', () => {
  it('createWithdrawTransaction throws RadfiApiError (not SyntaxError) on an HTML 403', async () => {
    fetchMock.mockResolvedValue(makeResponse(403, HTML_403));
    const radfi = new RadfiProvider(baseConfig);

    let caught: unknown;
    try {
      await radfi.createWithdrawTransaction(withdrawParams, 'access-token');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RadfiApiError);
    expect(caught).not.toBeInstanceOf(SyntaxError);
    expect((caught as RadfiApiError).status).toBe(403);
    // The original opaque failure mode must be gone.
    expect((caught as Error).message).not.toContain('Unexpected token');
    expect((caught as Error).message).toContain('403');
  });

  it('requestRadfiSignature throws RadfiApiError (not SyntaxError) on an HTML 502', async () => {
    fetchMock.mockResolvedValue(makeResponse(502, HTML_502));
    const radfi = new RadfiProvider(baseConfig);

    let caught: unknown;
    try {
      await radfi.requestRadfiSignature({ userAddress: withdrawParams.userAddress, signedBase64Tx: 'cHNidP8=' }, 'tok');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RadfiApiError);
    expect(caught).not.toBeInstanceOf(SyntaxError);
    expect((caught as RadfiApiError).status).toBe(502);
    expect((caught as Error).message).not.toContain('Unexpected token');
  });

  it('createTradingWallet (sibling method) also yields RadfiApiError on an HTML error body', async () => {
    // The issue only named two methods, but every method built a RadfiApiError from `await res.json()`
    // in its !res.ok branch — also throwing SyntaxError on an HTML error body. parseJsonBody fixes all.
    fetchMock.mockResolvedValue(makeResponse(403, HTML_403));
    const radfi = new RadfiProvider(baseConfig);

    let caught: unknown;
    try {
      await radfi.createTradingWallet({ walletAddress: withdrawParams.userAddress, publicKey: '02abcdef' }, 'tok');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RadfiApiError);
    expect((caught as RadfiApiError).status).toBe(403);
    expect((caught as Error).message).not.toContain('Unexpected token');
  });

  it('getTradingWallet surfaces the real HTTP status (403), not a generic "Trading wallet not found"', async () => {
    // The trading-wallet lookup is a public GET; an edge/WAF "403 Forbidden" HTML page used to throw a
    // generic Error('Trading wallet not found'), masking the real status. It must now be a typed
    // RadfiApiError carrying status 403 so an origin/WAF block is diagnosable.
    fetchMock.mockResolvedValue(makeResponse(403, HTML_403));
    const radfi = new RadfiProvider(baseConfig);

    let caught: unknown;
    try {
      await radfi.getTradingWallet('bc1pax7wcjw4r7m25fn2405x5a5f6vucv8pcqr8ltsz2mp4xjmx26rgstqgwhz');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RadfiApiError);
    expect(caught).not.toBeInstanceOf(SyntaxError);
    expect((caught as RadfiApiError).status).toBe(403);
    expect((caught as Error).message).not.toContain('Unexpected token');
    expect((caught as Error).message).toContain('403');
  });
});

describe('RadfiProvider — happy path + logical-error envelopes still work', () => {
  it('getTradingWallet returns the trading wallet on a valid JSON 200', async () => {
    const wallet = { tradingAddress: 'bc1ptrade', userAddress: 'bc1puser', userPublicKey: '02abcd' };
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: wallet })));
    const radfi = new RadfiProvider(baseConfig);

    expect(await radfi.getTradingWallet('bc1puser')).toEqual(wallet);
  });

  it('createWithdrawTransaction returns data on a valid JSON 200', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: { base64Psbt: 'cHNidP8=', txId: 'abc' } })));
    const radfi = new RadfiProvider(baseConfig);

    const result = await radfi.createWithdrawTransaction(withdrawParams, 'access-token');
    expect(result).toEqual({ base64Psbt: 'cHNidP8=', txId: 'abc' });
  });

  it('createWithdrawTransaction throws a typed RadfiApiError on a 200 logical-error envelope (no data)', async () => {
    // Bound can answer HTTP 200 with { code, message } and no `data` (e.g. "2002" insufficientBTCBalance).
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ code: '2002', message: 'insufficientBTCBalance' })));
    const radfi = new RadfiProvider(baseConfig);

    let caught: unknown;
    try {
      await radfi.createWithdrawTransaction(withdrawParams, 'access-token');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RadfiApiError);
    expect((caught as RadfiApiError).code).toBe('2002');
  });
});

describe('RadfiProvider — empty-credential guard (resolveAuth)', () => {
  it('createWithdrawTransaction throws a 401 RadfiApiError BEFORE any network call when no token/apiKey', async () => {
    const radfi = new RadfiProvider(baseConfig); // apiKey '' + token ''
    let caught: unknown;
    try {
      await radfi.createWithdrawTransaction(withdrawParams, '');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RadfiApiError);
    expect((caught as RadfiApiError).status).toBe(401);
    expect((caught as Error).message).toMatch(/required/i);
    // Pre-flight: we must NOT send an empty `Bearer ` to Bound (which 403s) — fail fast instead.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to config.apiKey when no access token is passed (does not over-block)', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: { base64Psbt: 'x', txId: 't' } })));
    const radfi = new RadfiProvider({ ...baseConfig, apiKey: 'server-api-key' });

    const result = await radfi.createWithdrawTransaction(withdrawParams, '');
    expect(result).toEqual({ base64Psbt: 'x', txId: 't' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer server-api-key');
  });
});

describe('RadfiProvider — constructor seeds the session from config', () => {
  it('seeds accessToken/refreshToken from RadfiConfig so a server-side caller can inject a token', () => {
    const radfi = new RadfiProvider({ ...baseConfig, accessToken: 'seed-access', refreshToken: 'seed-refresh' });
    expect(radfi.accessToken).toBe('seed-access');
    expect(radfi.refreshToken).toBe('seed-refresh');
  });

  it('defaults to empty strings when config has no token', () => {
    const radfi = new RadfiProvider(baseConfig);
    expect(radfi.accessToken).toBe('');
    expect(radfi.refreshToken).toBe('');
  });
});
