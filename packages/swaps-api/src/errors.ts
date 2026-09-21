/** Failure category for every {@link SwapsApiError}. */
export type SwapsApiErrorCode =
  | 'NETWORK_ERROR' // fetch threw (offline, DNS).
  | 'TIMEOUT_ERROR' // the request exceeded the configured `timeout` (aborted).
  | 'HTTP_ERROR' // server returned a non-2xx status.
  | 'PARSE_ERROR' // 2xx body was missing or not valid JSON.
  | 'VALIDATION_ERROR'; // body did not match the expected schema (or a request was malformed).

/** Diagnostic context attached to a {@link SwapsApiError}. All fields are best-effort. */
export interface SwapsApiErrorContext {
  /** The `ISwapsApiV2` method that failed, e.g. `'getQuote'`. */
  endpoint?: string;
  /** HTTP method actually sent, e.g. `'POST'`. */
  method?: string;
  /** Request path actually sent, e.g. `'/swaps/quote'`. */
  path?: string;
  /** HTTP status, for `HTTP_ERROR`. */
  status?: number;
  /**
   * Best-effort parsed backend response body. The v2 contract defines no error
   * type, so this is read defensively (JSON if possible, else text) and kept
   * `unknown` — the point is that the backend's message surfaces to the caller.
   */
  body?: unknown;
  /** valibot issues, for `VALIDATION_ERROR`. */
  issues?: unknown;
}

/** Single error type thrown by the client for every failure mode. */
export class SwapsApiError extends Error {
  readonly code: SwapsApiErrorCode;
  readonly context: SwapsApiErrorContext;

  constructor(
    code: SwapsApiErrorCode,
    message: string,
    context: SwapsApiErrorContext = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SwapsApiError';
    this.code = code;
    this.context = context;
    // Keep `instanceof SwapsApiError` working across dual ESM/CJS output.
    Object.setPrototypeOf(this, SwapsApiError.prototype);
  }
}
