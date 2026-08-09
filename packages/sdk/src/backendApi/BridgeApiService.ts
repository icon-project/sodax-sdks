// packages/sdk/src/backendApi/BridgeApiService.ts

import * as v from 'valibot';
import type {
  BaseApiConfig,
  BitcoinBoundExtrasV2,
  PartnerFeeV2,
  BridgeAllowanceCheckResponseV2,
  BridgeApproveResponseV2,
  BridgeFeeRequestV2,
  BridgeFeeResponseV2,
  BridgeQuoteRequestV2,
  BridgeableAmountResponseV2,
  BridgeableCheckResponseV2,
  BridgeSubmitTxRequestV2,
  BridgeSubmitTxResponseV2,
  BridgeSubmitTxStatusQueryV2,
  BridgeSubmitTxStatusResponseV2,
  CreateBridgeIntentParamsV2,
  CreateBridgeIntentResponseV2,
  GetBridgeTokensByChainResponseV2,
  GetBridgeTokensResponseV2,
  IBridgeApiV2,
  Result,
  SodaxLogger,
} from '@sodax/types';

import { makeRequest, toJsonBody, type RequestConfig, type RequestOverrideConfig } from './api-utils.js';
import * as schemas from './bridgeApiSchemas.js';
import { rawTxSchemaForChainKey } from './rawTxSchemas.js';
import { SodaxError } from '../errors/SodaxError.js';
import { consoleLogger } from '../shared/logger.js';

/**
 * {@link IBridgeApiV2} with every method's return wrapped in `Result<T>` and an
 * optional trailing `RequestOverrideConfig`. `BridgeApiService` implements this
 * (rather than `IBridgeApiV2` directly) because it never throws — like
 * `SwapsApiService`, it returns `{ ok: false }` on failure instead of
 * `Promise<T>` rejection. The mapped type keeps the class in lockstep with the
 * canonical interface: every endpoint is covered with its exact payload types.
 */
type ResultifiedBridgeApiV2 = {
  [K in keyof IBridgeApiV2]: IBridgeApiV2[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: [...A, config?: RequestOverrideConfig]) => Promise<Result<R>>
    : never;
};

/**
 * Map the SDK-domain bridge params (`CreateBridgeIntentParams`) onto the wire DTO
 * {@link CreateBridgeIntentParamsV2} (swaps naming). The input is typed structurally rather
 * than imported from `../bridge/BridgeService.js` to keep `backendApi` free of a
 * `backendApi → bridge` import cycle.
 *
 * @param params - SDK-domain params (`srcToken`/`dstToken`/`amount`/`recipient`).
 * @param extras - Optional `srcPublicKey` / Bitcoin `bound` extras.
 */
export function toCreateBridgeIntentParamsV2(
  params: {
    srcChainKey: string;
    dstChainKey: string;
    srcToken: string;
    dstToken: string;
    amount: bigint;
    srcAddress: string;
    recipient: string;
  },
  extras?: { srcPublicKey?: string; bound?: BitcoinBoundExtrasV2; partnerFee?: PartnerFeeV2 },
): CreateBridgeIntentParamsV2 {
  return {
    srcChainKey: params.srcChainKey,
    dstChainKey: params.dstChainKey,
    inputToken: params.srcToken,
    outputToken: params.dstToken,
    inputAmount: params.amount.toString(),
    srcAddress: params.srcAddress,
    dstAddress: params.recipient,
    ...(extras?.srcPublicKey !== undefined ? { srcPublicKey: extras.srcPublicKey } : {}),
    ...(extras?.bound !== undefined ? { bound: extras.bound } : {}),
    ...(extras?.partnerFee !== undefined ? { partnerFee: extras.partnerFee } : {}),
  };
}

/**
 * HTTP client for the backend **Bridge API v2** (`/bridge/*`).
 *
 * Mirrors every endpoint of {@link IBridgeApiV2} (one method per route) and
 * validates each response at runtime with a valibot schema (see
 * `bridgeApiSchemas.ts`). On a contract drift, the response is rejected as
 * `{ ok: false }` with a descriptive error rather than returned untyped.
 *
 * All public methods return `Promise<Result<T>>` — they never throw. On network
 * failure, timeout, non-2xx HTTP response, or response-shape validation failure,
 * the returned Result has `ok: false` with a canonical
 * `SodaxError<'EXTERNAL_API_ERROR'>` (`feature: 'backend'`, `context.api: 'bridge'`)
 * in the `error` field; the underlying failure is preserved on `error.cause`.
 *
 * Per-call request overrides (base URL, timeout, headers) can be passed as the
 * optional last argument to any method via `RequestOverrideConfig`.
 *
 * The Bridge API is served on the base backend host (`/bridge/*` sub-paths) — its config is resolved by
 * `resolveBridgeApiConfig` (an alias of `resolveBaseApiConfig`), so it is typed as a flat
 * {@link BaseApiConfig}. It defaults to the same host as the swaps client but is not configured with it:
 * a `swapsApiConfig` slice does not move the bridge routes; set `baseURL` / `baseApiConfig` instead.
 *
 * Reachable on the Sodax facade as `sodax.api.bridge`.
 */
export class BridgeApiService implements ResultifiedBridgeApiV2 {
  // Fully-resolved bridge-API config supplied by the caller (BackendApiService resolves the
  // `ApiConfig` union via `resolveBridgeApiConfig`); this service does not resolve the union.
  private readonly config: BaseApiConfig;
  private readonly headers: Record<string, string>;
  private readonly logger: SodaxLogger;

  constructor(config: BaseApiConfig, logger: SodaxLogger = consoleLogger) {
    this.config = config;
    this.headers = { ...config.headers };
    this.logger = logger;
  }

  /**
   * Issues a single HTTP request, validates the JSON body against `schema`, and
   * wraps the result in `Result<T>`. The service-level `baseURL`/`timeout`/
   * `headers` are merged with the optional per-call `overrideConfig` (which takes
   * precedence) inside {@link makeRequest}. Every public method delegates here.
   */
  private async request<S extends v.GenericSchema>(
    endpoint: string,
    config: RequestConfig,
    schema: S,
    overrideConfig?: RequestOverrideConfig,
  ): Promise<Result<v.InferOutput<S>, SodaxError<'EXTERNAL_API_ERROR'>>> {
    try {
      const raw = await makeRequest<unknown>({
        endpoint,
        config: { baseURL: this.config.baseURL, timeout: this.config.timeout, headers: this.headers, ...config },
        overrideConfig,
        logger: this.logger,
        serviceLabel: 'BridgeApiService',
      });

      const parsed = v.safeParse(schema, raw);
      if (!parsed.success) {
        // Backend returned a 2xx body that doesn't match the v2 contract — an upstream-API problem.
        return {
          ok: false,
          error: new SodaxError('EXTERNAL_API_ERROR', `Invalid response shape from bridge API for ${endpoint}`, {
            feature: 'backend',
            context: { api: 'bridge', endpoint, reason: 'invalid_response_shape', issues: v.flatten(parsed.issues) },
          }),
        };
      }
      return { ok: true, value: parsed.output };
    } catch (error) {
      // Network failure, timeout, or non-2xx HTTP status thrown by makeRequest. Preserve the
      // underlying error as `cause` (carries HTTP_REQUEST_FAILED / REQUEST_TIMEOUT / etc.).
      return {
        ok: false,
        error: new SodaxError(
          'EXTERNAL_API_ERROR',
          error instanceof Error ? error.message : `Request to ${endpoint} failed`,
          {
            feature: 'backend',
            cause: error,
            context: { api: 'bridge', endpoint },
          },
        ),
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Tokens
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Fetch all supported bridge tokens grouped by SpokeChainKey.
   *
   * @returns `Result<GetBridgeTokensResponseV2>` — map of chain key → token list.
   */
  public async getTokens(config?: RequestOverrideConfig): Promise<Result<GetBridgeTokensResponseV2>> {
    return this.request('/bridge/tokens', { method: 'GET' }, schemas.BridgeTokensResponseSchema, config);
  }

  /**
   * Fetch supported bridge tokens for a single SpokeChainKey.
   *
   * @param chainKey - SODAX SpokeChainKey (e.g. `0xa4b1.arbitrum`, `solana`).
   * @returns `Result<GetBridgeTokensByChainResponseV2>` — token list for the chain.
   */
  public async getTokensByChain(
    chainKey: string,
    config?: RequestOverrideConfig,
  ): Promise<Result<GetBridgeTokensByChainResponseV2>> {
    return this.request(
      `/bridge/tokens/${chainKey}`,
      { method: 'GET' },
      schemas.BridgeTokensByChainResponseSchema,
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Allowance · approve · create intent
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Check whether the source token allowance is already sufficient for the bridge.
   *
   * @returns `Result<BridgeAllowanceCheckResponseV2>` — `{ valid }`.
   */
  public async checkAllowance(
    body: CreateBridgeIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeAllowanceCheckResponseV2>> {
    return this.request(
      '/bridge/allowance/check',
      { method: 'POST', body: toJsonBody(body) },
      schemas.BridgeAllowanceCheckResponseSchema,
      config,
    );
  }

  /**
   * Build an unsigned token-approval transaction for the source token.
   *
   * @returns `Result<BridgeApproveResponseV2>` — `{ tx }` (chain-specific unsigned tx).
   */
  public async approve(
    body: CreateBridgeIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeApproveResponseV2>> {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return this.request(
      '/bridge/approve',
      { method: 'POST', body: toJsonBody(body) },
      schemas.makeBridgeApproveResponseSchema(txSchema),
      config,
    );
  }

  /**
   * Build an unsigned spoke-deposit (create-bridge-intent) transaction.
   *
   * @returns `Result<CreateBridgeIntentResponseV2>` — `{ tx, relayData }` (no intent struct).
   */
  public async createBridgeIntent(
    body: CreateBridgeIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CreateBridgeIntentResponseV2>> {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return this.request(
      '/bridge/intents',
      { method: 'POST', body: toJsonBody(body) },
      schemas.makeCreateBridgeIntentResponseSchema(txSchema),
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Submit-tx state machine
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Submit a broadcast bridge (spoke-deposit) transaction to be processed (relayed).
   * Carries the FULL `relayData { address, payload }` envelope. Idempotent on `(txHash, srcChainKey)`.
   *
   * @returns `Result<BridgeSubmitTxResponseV2>` — `{ success, data: { status, message } }`.
   */
  public async submitTx(
    body: BridgeSubmitTxRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeSubmitTxResponseV2>> {
    return this.request(
      '/bridge/submit-tx',
      { method: 'POST', body: toJsonBody(body) },
      schemas.BridgeSubmitTxResponseSchema,
      config,
    );
  }

  /**
   * Get the processing status of a submitted bridge transaction by `(txHash, srcChainKey)`.
   *
   * @returns `Result<BridgeSubmitTxStatusResponseV2>` — `{ success, data }` (processing state).
   */
  public async getSubmitTxStatus(
    query: BridgeSubmitTxStatusQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeSubmitTxStatusResponseV2>> {
    const queryParams = new URLSearchParams({ txHash: query.txHash, srcChainKey: query.srcChainKey });
    return this.request(
      `/bridge/submit-tx/status?${queryParams.toString()}`,
      { method: 'GET' },
      schemas.BridgeSubmitTxStatusResponseSchema,
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Fee · bridgeable quote (read-only; mirror the SDK-core client-side methods)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Bridge partner fee for an input amount (per-request `partnerFee` override, else the configured default).
   * NOTE: this is a pure client-side computation
   * in the SDK core (`sodax.bridge.getFee`) — prefer that (no round-trip); this HTTP variant exists for
   * parity with the backend `/bridge/fee` endpoint (for consumers using only `sodax.api.bridge`).
   *
   * @returns `Result<BridgeFeeResponseV2>` — `{ fee }` (decimal string).
   */
  public async getFee(body: BridgeFeeRequestV2, config?: RequestOverrideConfig): Promise<Result<BridgeFeeResponseV2>> {
    return this.request(
      '/bridge/fee',
      { method: 'POST', body: toJsonBody(body) },
      schemas.BridgeFeeResponseSchema,
      config,
    );
  }

  /**
   * Deposit capacity / withdrawal liquidity for a (from, to) token pair. Computable client-side in the
   * SDK core (`sodax.bridge.getBridgeableAmount`); this HTTP variant mirrors `/bridge/bridgeable-amount`.
   *
   * @returns `Result<BridgeableAmountResponseV2>` — `{ limit }`.
   */
  public async getBridgeableAmount(
    body: BridgeQuoteRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeableAmountResponseV2>> {
    return this.request(
      '/bridge/bridgeable-amount',
      { method: 'POST', body: toJsonBody(body) },
      schemas.BridgeableAmountResponseSchema,
      config,
    );
  }

  /**
   * Whether a (from, to) token pair is bridgeable. Computable client-side in the SDK core
   * (`sodax.bridge.isBridgeable`); this HTTP variant mirrors `/bridge/bridgeable/check`.
   *
   * @returns `Result<BridgeableCheckResponseV2>` — `{ bridgeable }`.
   */
  public async isBridgeable(
    body: BridgeQuoteRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeableCheckResponseV2>> {
    return this.request(
      '/bridge/bridgeable/check',
      { method: 'POST', body: toJsonBody(body) },
      schemas.BridgeableCheckResponseSchema,
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Utilities (parity with SwapsApiService)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Merge additional headers into the service's default header set. Existing
   * keys are overwritten; keys absent from `headers` are preserved.
   */
  public setHeaders(headers: Record<string, string>): void {
    Object.entries(headers).forEach(([key, value]) => {
      this.headers[key] = value;
    });
  }

  /** Return the base URL the service is currently pointing at. */
  public getBaseURL(): string {
    return this.config.baseURL;
  }

  /**
   * Return the effective per-request timeout (ms).
   *
   * Callers bounding a request tighter than this need it as the CEILING, because a
   * `RequestOverrideConfig.timeout` REPLACES the service value rather than lowering it: an override
   * derived from a caller budget alone would raise the bound whenever that budget is the larger of the
   * two. `SubmitTxAttempt.requestTimeout` clamps against both (`min(budget left in the attempt, this)`).
   */
  public getTimeout(): number {
    return this.config.timeout;
  }
}
