import { BridgeApiError } from './errors.js';
import { rejectBigint } from './serialize.js';

type HttpMethod = 'GET' | 'POST';

/** Query value types that appear in the v2 contract. `undefined` keys are omitted from the URL. */
type QueryValue = string | number | boolean | undefined;
type QueryParams = Record<string, QueryValue>;

/** Per-client transport state, built once by `BridgeApi` from its `BridgeApiConfig`. */
export interface RequestContext {
  baseUrl: string;
  fetchImpl: typeof globalThis.fetch;
  defaultHeaders?: Record<string, string>;
  /** Overall per-call deadline (ms), enforced across all retries. Omit for no timeout. */
  timeout?: number;
}

/** Everything one endpoint call needs. `parse` validates+narrows the response (valibot lives here). */
interface RequestSpec<T> {
  method: HttpMethod;
  /** Fully-formed path with any params already `encodeURIComponent`-escaped, e.g. `/bridge/fee`. */
  path: string;
  /** `IBridgeApiV2` method name, used only for error context. */
  endpoint: string;
  query?: QueryParams;
  /** JSON-safe body — the bridge wire DTOs are fully string-typed, no bigint serialization needed. */
  body?: unknown;
  parse: (raw: unknown) => T;
  /** Idempotent/safe-to-replay calls (read GETs, polls) may be retried; mutations must not. */
  idempotent?: boolean;
}

/** A small fixed retry budget for idempotent calls, no backoff (kept minimal). */
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
  // Linear trailing-slash trim (avoids a polynomial `/\/+$/` regex over library-supplied input).
  let end = baseUrl.length;
  while (end > 0 && baseUrl.codePointAt(end - 1) === 47 /* '/' */) end--;
  const base = baseUrl.slice(0, end);
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
 * validate the JSON. Always throws {@link BridgeApiError} on failure (per the throwing contract).
 * Retries only idempotent calls on transient statuses / network errors. When `ctx.timeout` is set,
 * a single `AbortController` bounds the WHOLE call (all retries) — a hard latency ceiling — and its
 * expiry surfaces as `TIMEOUT_ERROR` without consuming the retry budget.
 */
export async function request<T>(ctx: RequestContext, spec: RequestSpec<T>): Promise<T> {
  const url = buildUrl(ctx.baseUrl, spec.path, spec.query);
  const context = { endpoint: spec.endpoint, method: spec.method, path: spec.path };

  const headers: Record<string, string> = { ...ctx.defaultHeaders };
  let bodyText: string | undefined;
  if (spec.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    // rejectBigint throws if a runtime bigint slipped into a wire DTO — fail loud, never silently coerce.
    bodyText = JSON.stringify(spec.body, rejectBigint);
  }

  // One deadline for the whole call (shared across retries), so `timeout` is a hard ceiling on total
  // latency rather than a per-attempt window. No `timeout` → no controller, no abort.
  const controller = ctx.timeout === undefined ? undefined : new AbortController();
  const timeoutId = controller ? setTimeout(() => controller.abort(), ctx.timeout) : undefined;
  // Our deadline fired mid-flight: any in-progress await rejects, so classify as TIMEOUT_ERROR
  // regardless of which await caught it (signal.aborted is true only when OUR controller aborted).
  const timedOut = (): boolean => controller?.signal.aborted === true;
  const timeoutError = (cause?: unknown): BridgeApiError =>
    new BridgeApiError('TIMEOUT_ERROR', `${spec.endpoint} timed out after ${ctx.timeout}ms`, context, { cause });

  const maxAttempts = spec.idempotent ? MAX_RETRIES + 1 : 1;
  let lastError: BridgeApiError | undefined;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await ctx.fetchImpl(url, {
          method: spec.method,
          headers,
          body: bodyText,
          signal: controller?.signal,
        });
      } catch (cause) {
        // Our deadline fired: surface a distinct TIMEOUT_ERROR and stop. The budget is spent, and the
        // already-tripped signal would abort every remaining attempt instantly anyway.
        if (timedOut()) throw timeoutError(cause);
        lastError = new BridgeApiError('NETWORK_ERROR', `Request to ${spec.endpoint} failed`, context, { cause });
        if (attempt < maxAttempts) continue;
        throw lastError;
      }

      if (!response.ok) {
        const body = await readBodySafe(response);
        // A deadline that fired during the (best-effort) error-body read is still a timeout, not an
        // HTTP error — and must stop the call rather than fall through to the retry check below.
        if (timedOut()) throw timeoutError();
        lastError = new BridgeApiError('HTTP_ERROR', `${spec.endpoint} responded with ${response.status}`, {
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
        // The deadline can fire mid-body-read: a rejected json() with the signal aborted is a timeout,
        // not a malformed body.
        if (timedOut()) throw timeoutError(cause);
        throw new BridgeApiError('PARSE_ERROR', `${spec.endpoint} returned a non-JSON body`, context, { cause });
      }

      try {
        return spec.parse(raw);
      } catch (cause) {
        throw new BridgeApiError('VALIDATION_ERROR', `${spec.endpoint} response failed validation`, {
          ...context,
          issues: cause,
        });
      }
    }

    // Unreachable (maxAttempts >= 1), but keeps the function total for the type checker.
    throw lastError ?? new BridgeApiError('NETWORK_ERROR', `${spec.endpoint} failed`, context);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
