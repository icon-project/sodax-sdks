// packages/sdk/src/backendApi/SwapsApiService.ts

import * as v from 'valibot';
import type {
  AllowanceCheckResponseV2,
  SwapsApiConfig,
  ApproveResponseV2,
  CancelIntentRequestV2,
  CancelIntentResponseV2,
  CreateIntentParamsV2,
  CreateIntentResponseV2,
  CreateLimitOrderParamsV2,
  CreateLimitOrderResponseV2,
  DeadlineQueryV2,
  DeadlineResponseV2,
  FeeQueryV2,
  FeeResponseV2,
  GasEstimateRequestV2,
  GasEstimateResponseV2,
  GetIntentResponseV2,
  GetSwapTokensByChainResponseV2,
  GetSwapTokensResponseV2,
  IntentExtraDataRequestV2,
  IntentExtraDataResponseV2,
  IntentHashRequestV2,
  IntentHashResponseV2,
  IntentPacketRequestV2,
  IntentPacketResponseV2,
  IntentStateV2,
  ISwapsApiV2,
  QuoteQueryV2,
  QuoteRequestV2,
  QuoteResponseV2,
  Result,
  StatusRequestV2,
  StatusResponseV2,
  SubmitIntentRequestV2,
  SubmitIntentResponseV2,
  SubmitTxRequestV2,
  SubmitTxResponseV2,
  SubmitTxStatusQueryV2,
  SubmitTxStatusResponseV2,
  SodaxLogger,
} from '@sodax/types';

import { makeRequest, toJsonBody, type RequestConfig, type RequestOverrideConfig } from './api-utils.js';
import * as schemas from './swapsApiSchemas.js';
import { rawTxSchemaForChainKey } from './rawTxSchemas.js';
import { SodaxError } from '../errors/SodaxError.js';
import { consoleLogger } from '../shared/logger.js';

/**
 * {@link ISwapsApiV2} with every method's return wrapped in `Result<T>` and an
 * optional trailing `RequestOverrideConfig`. `SwapsApiService` implements this
 * (rather than `ISwapsApiV2` directly) because it never throws — like
 * `BackendApiService`, it returns `{ ok: false }` on failure instead of
 * `Promise<T>` rejection. The mapped type keeps the class in lockstep with the
 * canonical interface: every endpoint is covered with its exact payload types.
 */
type ResultifiedSwapsApiV2 = {
  [K in keyof ISwapsApiV2]: ISwapsApiV2[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: [...A, config?: RequestOverrideConfig]) => Promise<Result<R>>
    : never;
};

/**
 * HTTP client for the backend **Swaps API v2** (`/swaps/*`).
 *
 * Mirrors every endpoint of {@link ISwapsApiV2} (one method per route) and
 * validates each response at runtime with a valibot schema (see
 * `swapsApiSchemas.ts`). On a contract drift, the response is rejected as
 * `{ ok: false }` with a descriptive error rather than returned untyped.
 *
 * All public methods return `Promise<Result<T>>` — they never throw. On network
 * failure, timeout, non-2xx HTTP response, or response-shape validation failure,
 * the returned Result has `ok: false` with a canonical
 * `SodaxError<'EXTERNAL_API_ERROR'>` (`feature: 'backend'`, `context.api: 'backend'`)
 * in the `error` field; the underlying failure is preserved on `error.cause`.
 *
 * Per-call request overrides (base URL, timeout, headers) can be passed as the
 * optional last argument to any method via `RequestOverrideConfig`.
 *
 * Reachable on the Sodax facade as `sodax.api.swaps`.
 */
export class SwapsApiService implements ResultifiedSwapsApiV2 {
  // Fully-resolved swaps-API config supplied by the caller (BackendApiService resolves the
  // `ApiConfig` union via `resolveSwapsApiConfig`); this service does not resolve the union.
  private readonly config: SwapsApiConfig;
  private readonly headers: Record<string, string>;
  private readonly logger: SodaxLogger;

  constructor(config: SwapsApiConfig, logger: SodaxLogger = consoleLogger) {
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
      });

      const parsed = v.safeParse(schema, raw);
      if (!parsed.success) {
        // Backend returned a 2xx body that doesn't match the v2 contract — an upstream-API problem.
        return {
          ok: false,
          error: new SodaxError('EXTERNAL_API_ERROR', `Invalid response shape from swaps API for ${endpoint}`, {
            feature: 'backend',
            context: { api: 'backend', endpoint, reason: 'invalid_response_shape', issues: v.flatten(parsed.issues) },
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
            context: { api: 'backend', endpoint },
          },
        ),
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Tokens
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Fetch all supported swap tokens grouped by SpokeChainKey.
   *
   * @returns `Result<GetSwapTokensResponseV2>` — map of chain key → token list.
   */
  public async getTokens(config?: RequestOverrideConfig): Promise<Result<GetSwapTokensResponseV2>> {
    return this.request('/swaps/tokens', { method: 'GET' }, schemas.GetSwapTokensResponseSchema, config);
  }

  /**
   * Fetch supported swap tokens for a single SpokeChainKey.
   *
   * @param chainKey - SODAX SpokeChainKey (e.g. `0xa4b1.arbitrum`, `solana`).
   * @returns `Result<GetSwapTokensByChainResponseV2>` — token list for the chain.
   */
  public async getTokensByChain(
    chainKey: string,
    config?: RequestOverrideConfig,
  ): Promise<Result<GetSwapTokensByChainResponseV2>> {
    return this.request(
      `/swaps/tokens/${chainKey}`,
      { method: 'GET' },
      schemas.GetSwapTokensByChainResponseSchema,
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Quote · deadline
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Get a solver quote for a cross-chain swap.
   *
   * Pass `query.includeTxData = true` to also build an unsigned create-intent
   * transaction (`txData`) using the quoted amount as `minOutputAmount`; in that
   * case `srcAddress`/`dstAddress` are required in the body.
   *
   * @returns `Result<QuoteResponseV2>` — `quotedAmount` (decimal string) and optional `txData`.
   */
  public async getQuote(
    body: QuoteRequestV2,
    query?: QuoteQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<QuoteResponseV2>> {
    const endpoint = query?.includeTxData ? '/swaps/quote?includeTxData=true' : '/swaps/quote';
    const txSchema = rawTxSchemaForChainKey(body.tokenSrcChainKey);
    return this.request(
      endpoint,
      { method: 'POST', body: toJsonBody(body) },
      schemas.makeQuoteResponseSchema(txSchema),
      config,
    );
  }

  /**
   * Compute a swap deadline (hub timestamp + `offsetSeconds`, default 300s).
   *
   * @returns `Result<DeadlineResponseV2>` — unix-seconds deadline (decimal string).
   */
  public async getDeadline(
    query?: DeadlineQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<DeadlineResponseV2>> {
    const queryParams = new URLSearchParams();
    if (query?.offsetSeconds !== undefined) queryParams.append('offsetSeconds', String(query.offsetSeconds));
    const queryString = queryParams.toString();
    const endpoint = queryString.length > 0 ? `/swaps/deadline?${queryString}` : '/swaps/deadline';
    return this.request(endpoint, { method: 'GET' }, schemas.DeadlineResponseSchema, config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Allowance · approve · create intent
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Check whether the source token allowance is already sufficient for the intent.
   *
   * @returns `Result<AllowanceCheckResponseV2>` — `{ valid }`.
   */
  public async checkAllowance(
    body: CreateIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<AllowanceCheckResponseV2>> {
    return this.request(
      '/swaps/allowance/check',
      { method: 'POST', body: toJsonBody(body) },
      schemas.AllowanceCheckResponseSchema,
      config,
    );
  }

  /**
   * Build an unsigned token-approval transaction for the source token.
   *
   * @returns `Result<ApproveResponseV2>` — `{ tx }` (chain-specific unsigned tx).
   */
  public async approve(body: CreateIntentParamsV2, config?: RequestOverrideConfig): Promise<Result<ApproveResponseV2>> {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return this.request(
      '/swaps/approve',
      { method: 'POST', body: toJsonBody(body) },
      schemas.makeApproveResponseSchema(txSchema),
      config,
    );
  }

  /**
   * Build an unsigned create-intent transaction.
   *
   * @returns `Result<CreateIntentResponseV2>` — `{ tx, intent, relayData }`.
   */
  public async createIntent(
    body: CreateIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CreateIntentResponseV2>> {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return this.request(
      '/swaps/intents',
      { method: 'POST', body: toJsonBody(body) },
      schemas.makeCreateIntentResponseSchema(txSchema),
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Intent lifecycle: submit · status · cancel · hash · packet · extra-data
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Submit the broadcast intent tx to the relay.
   *
   * @returns `Result<SubmitIntentResponseV2>` — `{ result }` (opaque relay response).
   */
  public async submitIntent(
    body: SubmitIntentRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitIntentResponseV2>> {
    return this.request(
      '/swaps/intents/submit',
      { method: 'POST', body: toJsonBody(body) },
      schemas.SubmitIntentResponseSchema,
      config,
    );
  }

  /**
   * Poll the solver for intent execution status.
   *
   * @returns `Result<StatusResponseV2>` — `{ status, fillTxHash? }` (`fillTxHash` set when `status === 3`).
   */
  public async getStatus(body: StatusRequestV2, config?: RequestOverrideConfig): Promise<Result<StatusResponseV2>> {
    return this.request(
      '/swaps/intents/status',
      { method: 'POST', body: toJsonBody(body) },
      schemas.StatusResponseSchema,
      config,
    );
  }

  /**
   * Build an unsigned cancel-intent transaction. The `intent` field carries
   * `bigint` numerics — {@link toJsonBody} serializes them to decimal strings.
   *
   * @returns `Result<CancelIntentResponseV2>` — `{ tx }`.
   */
  public async cancelIntent(
    body: CancelIntentRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CancelIntentResponseV2>> {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return this.request(
      '/swaps/intents/cancel',
      { method: 'POST', body: toJsonBody(body) },
      schemas.makeCancelIntentResponseSchema(txSchema),
      config,
    );
  }

  /**
   * Compute the keccak256 hash of an Intent struct. The `intent` field carries
   * `bigint` numerics — {@link toJsonBody} serializes them to decimal strings.
   *
   * @returns `Result<IntentHashResponseV2>` — `{ hash }`.
   */
  public async getIntentHash(
    body: IntentHashRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<IntentHashResponseV2>> {
    return this.request(
      '/swaps/intents/hash',
      { method: 'POST', body: toJsonBody(body) },
      schemas.IntentHashResponseSchema,
      config,
    );
  }

  /**
   * Long-poll the relayer until the fill packet lands on the destination chain.
   *
   * @returns `Result<IntentPacketResponseV2>` — delivered packet data.
   */
  public async getSolvedIntentPacket(
    body: IntentPacketRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<IntentPacketResponseV2>> {
    return this.request(
      '/swaps/intents/packet',
      { method: 'POST', body: toJsonBody(body) },
      schemas.IntentPacketResponseSchema,
      config,
    );
  }

  /**
   * Recover the relay extra data needed by `/swaps/intents/submit`. Provide
   * EITHER `txHash` OR `intent` (whose `bigint` numerics {@link toJsonBody} serializes).
   *
   * @returns `Result<IntentExtraDataResponseV2>` — `{ address, payload }`.
   */
  public async getIntentSubmitTxExtraData(
    body: IntentExtraDataRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<IntentExtraDataResponseV2>> {
    return this.request(
      '/swaps/intents/extra-data',
      { method: 'POST', body: toJsonBody(body) },
      schemas.RelayExtraDataResponseSchema,
      config,
    );
  }

  /**
   * Get the on-chain fill state for an intent by its hub-chain tx hash.
   *
   * @returns `Result<IntentStateV2>` — `{ exists, remainingInput, receivedOutput, pendingPayment }`.
   */
  public async getFilledIntent(txHash: string, config?: RequestOverrideConfig): Promise<Result<IntentStateV2>> {
    return this.request(`/swaps/intents/${txHash}/fill`, { method: 'GET' }, schemas.IntentStateResponseSchema, config);
  }

  /**
   * Look up an Intent struct by its hub-chain creation tx hash.
   *
   * @returns `Result<GetIntentResponseV2>` — the decoded intent (bigint fields as decimal strings).
   */
  public async getIntent(txHash: string, config?: RequestOverrideConfig): Promise<Result<GetIntentResponseV2>> {
    return this.request(`/swaps/intents/${txHash}`, { method: 'GET' }, schemas.IntentResponseSchema, config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Limit orders · gas · fees
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Build an unsigned create-limit-order-intent transaction (same as create-intent
   * but `deadline` is optional).
   *
   * @returns `Result<CreateLimitOrderResponseV2>` — `{ tx, intent, relayData }`.
   */
  public async createLimitOrderIntent(
    body: CreateLimitOrderParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CreateLimitOrderResponseV2>> {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return this.request(
      '/swaps/limit-orders',
      { method: 'POST', body: toJsonBody(body) },
      schemas.makeCreateIntentResponseSchema(txSchema),
      config,
    );
  }

  /**
   * Estimate gas for a raw transaction on a spoke chain.
   *
   * @returns `Result<GasEstimateResponseV2>` — `{ gas }` (chain-specific shape).
   */
  public async estimateGas(
    body: GasEstimateRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<GasEstimateResponseV2>> {
    return this.request(
      '/swaps/gas/estimate',
      { method: 'POST', body: toJsonBody(body) },
      schemas.GasEstimateResponseSchema,
      config,
    );
  }

  /**
   * Compute the partner fee for a given input amount.
   *
   * @returns `Result<FeeResponseV2>` — `{ fee }` (decimal string).
   */
  public async getPartnerFee(query: FeeQueryV2, config?: RequestOverrideConfig): Promise<Result<FeeResponseV2>> {
    const queryParams = new URLSearchParams({ amount: query.amount });
    return this.request(
      `/swaps/fees/partner?${queryParams.toString()}`,
      { method: 'GET' },
      schemas.FeeResponseSchema,
      config,
    );
  }

  /**
   * Compute the protocol (solver) fee for a given input amount.
   *
   * @returns `Result<FeeResponseV2>` — `{ fee }` (decimal string).
   */
  public async getSolverFee(query: FeeQueryV2, config?: RequestOverrideConfig): Promise<Result<FeeResponseV2>> {
    const queryParams = new URLSearchParams({ amount: query.amount });
    return this.request(
      `/swaps/fees/solver?${queryParams.toString()}`,
      { method: 'GET' },
      schemas.FeeResponseSchema,
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Submit-tx state machine
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Submit a swap transaction to be processed (relay, post-execution, etc.). The
   * `intent` field carries `bigint` numerics — {@link toJsonBody} serializes them.
   * Idempotent on `(txHash, srcChainKey)`.
   *
   * @returns `Result<SubmitTxResponseV2>` — `{ success, data: { status, message } }`.
   */
  public async submitTx(body: SubmitTxRequestV2, config?: RequestOverrideConfig): Promise<Result<SubmitTxResponseV2>> {
    return this.request(
      '/swaps/submit-tx',
      { method: 'POST', body: toJsonBody(body) },
      schemas.SubmitTxResponseSchema,
      config,
    );
  }

  /**
   * Get the processing status of a submitted swap transaction by `(txHash, srcChainKey)`.
   *
   * @returns `Result<SubmitTxStatusResponseV2>` — `{ success, data }` (processing state).
   */
  public async getSubmitTxStatus(
    query: SubmitTxStatusQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitTxStatusResponseV2>> {
    const queryParams = new URLSearchParams({ txHash: query.txHash, srcChainKey: query.srcChainKey });
    return this.request(
      `/swaps/submit-tx/status?${queryParams.toString()}`,
      { method: 'GET' },
      schemas.SubmitTxStatusResponseSchema,
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Utilities (parity with BackendApiService)
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
}
