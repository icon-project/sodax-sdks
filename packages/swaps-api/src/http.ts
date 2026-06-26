import { SwapsApiError } from './errors.js';
import { rejectBigint } from './serialize.js';

type HttpMethod = 'GET' | 'POST';

/** Query value types that appear in the v2 contract. `undefined` keys are omitted from the URL. */
type QueryValue = string | number | boolean | undefined;
type QueryParams = Record<string, QueryValue>;

/** Per-client transport state, built once by `SwapsApi` from its `SwapsApiConfig`. */
export interface RequestContext {
  baseUrl: string;
  fetchImpl: typeof globalThis.fetch;
  defaultHeaders?: Record<string, string>;
}

/** Everything one endpoint call needs. `parse` validates+narrows the response (valibot lives here). */
interface RequestSpec<T> {
  method: HttpMethod;
  /** Fully-formed path with any params already `encodeURIComponent`-escaped, e.g. `/swaps/quote`. */
  path: string;
  /** `ISwapsApiV2` method name, used only for error context. */
  endpoint: string;
  query?: QueryParams;
  /** Domain body already run through `serialize.ts` (bigint fields → strings). */
  body?: unknown;
  parse: (raw: unknown) => T;
  /** Idempotent/safe-to-replay calls (read GETs, polls) may be retried; mutations must not. */
  idempotent?: boolean;
}

/** Decision F: a small fixed retry budget for idempotent calls, no backoff (kept minimal). */
const MAX_RETRIES = 2;

/** Transient statuses worth replaying for an idempotent call. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Serialize a query object: `boolean`/`number` → string, `undefined` omitted. Returns `''` or `?a=b`. */
export function buildQuery(query: QueryParams | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

/** Join `baseUrl` + `path` + query. `path` is expected to be pre-encoded by the caller. */
export function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
  const base = baseUrl.replace(/\/+$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}${buildQuery(query)}`;
}

async function readBodySafe(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => undefined);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text; // not JSON — surface the raw text so the backend message isn't lost.
  }
}

/**
 * Perform one endpoint call: build the URL, send via the injected `fetch`, and on success parse +
 * validate the JSON. Always throws {@link SwapsApiError} on failure (per the throwing contract).
 * Retries only idempotent calls on transient statuses / network errors.
 */
export async function request<T>(ctx: RequestContext, spec: RequestSpec<T>): Promise<T> {
  const url = buildUrl(ctx.baseUrl, spec.path, spec.query);
  const context = { endpoint: spec.endpoint, method: spec.method, path: spec.path };

  const headers: Record<string, string> = { ...ctx.defaultHeaders };
  let bodyText: string | undefined;
  if (spec.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    // rejectBigint throws if a bigint slipped past serialize.ts — fail loud, never silently coerce.
    bodyText = JSON.stringify(spec.body, rejectBigint);
  }

  const maxAttempts = spec.idempotent ? MAX_RETRIES + 1 : 1;
  let lastError: SwapsApiError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await ctx.fetchImpl(url, { method: spec.method, headers, body: bodyText });
    } catch (cause) {
      lastError = new SwapsApiError('NETWORK_ERROR', `Request to ${spec.endpoint} failed`, context, { cause });
      if (attempt < maxAttempts) continue;
      throw lastError;
    }

    if (!response.ok) {
      const body = await readBodySafe(response);
      lastError = new SwapsApiError('HTTP_ERROR', `${spec.endpoint} responded with ${response.status}`, {
        ...context,
        status: response.status,
        body,
      });
      if (attempt < maxAttempts && RETRYABLE_STATUS.has(response.status)) continue;
      throw lastError;
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch (cause) {
      throw new SwapsApiError('PARSE_ERROR', `${spec.endpoint} returned a non-JSON body`, context, { cause });
    }

    try {
      return spec.parse(raw);
    } catch (cause) {
      throw new SwapsApiError('VALIDATION_ERROR', `${spec.endpoint} response failed validation`, {
        ...context,
        issues: cause,
      });
    }
  }

  // Unreachable (maxAttempts >= 1), but keeps the function total for the type checker.
  throw lastError ?? new SwapsApiError('NETWORK_ERROR', `${spec.endpoint} failed`, context);
}
