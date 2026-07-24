import { DEFAULT_BACKEND_API_TIMEOUT, type SodaxLogger } from '@sodax/types';

/**
 * Shape used to type certain backend responses that include a `data` envelope.
 * Not all endpoints use this wrapper — the `request` method parses raw JSON
 * directly as `T` without any envelope. Use this interface only when a specific
 * endpoint is documented to return `{ data, status, message? }`.
 */
export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  message?: string;
}

/** Shape passed to `makeRequest` to configure a single HTTP call. */
export interface RequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  baseURL?: string;
}

/**
 * Per-call overrides that take precedence over the `ApiConfig` the service
 * was constructed with. Useful for directing a single request to a different
 * host or applying request-specific headers (e.g. auth tokens, tracing IDs).
 */
export type RequestOverrideConfig = {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
};

export type MakeRequestParams = {
  endpoint: string;
  config: RequestConfig;
  overrideConfig?: RequestOverrideConfig;
  logger: SodaxLogger;
  /** Calling service's label, used only as the error-log prefix (e.g. `'SwapsApiService'`). */
  serviceLabel: string;
};

/**
 * Execute a single HTTP request and return the parsed JSON body.
 *
 * Resolves the effective base URL, headers, and timeout from `config` (the
 * service defaults) merged with the optional per-call `overrideConfig`, which
 * takes precedence. Applies an `AbortController`-backed timeout. Throws on
 * non-2xx status codes or when the request exceeds the timeout, so callers
 * should use {@link request} instead of calling this directly.
 *
 * @throws `Error('HTTP_REQUEST_FAILED')` on non-2xx responses.
 * @throws `Error('REQUEST_TIMEOUT')` when the request exceeds the timeout.
 * @throws `Error('UNKNOWN_REQUEST_ERROR')` for any other unexpected failure.
 */
export async function makeRequest<T>(params: MakeRequestParams): Promise<T> {
  const { endpoint, config, overrideConfig = {}, logger, serviceLabel } = params;
  // Truthy (not nullish) fallback mirrors the original behavior: an empty-string
  // baseURL is treated as "not provided" and falls back to the service default.
  const baseURL = overrideConfig.baseURL || config.baseURL || '';
  const url = `${baseURL}${endpoint}`;
  // Per-call override headers take precedence over the service defaults.
  const headers = { ...config.headers, ...overrideConfig.headers };

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeout = overrideConfig.timeout ?? config.timeout ?? DEFAULT_BACKEND_API_TIMEOUT;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: config.method,
      headers,
      body: config.body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error('HTTP_REQUEST_FAILED', { cause: new Error(`HTTP ${response.status}: ${errorText}`) });
    }

    const data = await response.json();
    return data;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('REQUEST_TIMEOUT', { cause: new Error(`Request timeout after ${timeout}ms`) });
      }
      logger.error(`[${serviceLabel}] Request error`, error);
      throw error;
    }

    logger.error(`[${serviceLabel}] Unknown error`, error);
    throw new Error('UNKNOWN_REQUEST_ERROR', { cause: error });
  }
}
