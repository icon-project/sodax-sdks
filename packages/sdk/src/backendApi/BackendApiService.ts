// packages/sdk/src/services/BackendApiService.ts

import type {
  Address,
  GetAllConfigApiResponse,
  GetChainsApiResponse,
  GetMoneyMarketReserveAssetsApiResponse,
  GetMoneyMarketTokensApiResponse,
  GetMoneyMarketTokensByChainIdApiResponse,
  GetRelayChainIdMapApiResponse,
  GetSpokeChainConfigApiResponse,
  GetSwapTokensApiResponse,
  GetSwapTokensByChainIdApiResponse,
  IConfigApi,
  Result,
  SpokeChainKey,
  SubmitSwapTxRequest,
  SubmitSwapTxResponse,
  GetSubmitSwapTxStatusParams,
  SubmitSwapTxStatusResponse,
  ApiConfig,
} from '@sodax/types';

import { isSubmitSwapTxResponse, isSubmitSwapTxStatusResponse } from '../shared/guards.js';

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

/** Full details of a single swap intent as stored and returned by the backend. */
export interface IntentResponse {
  intentHash: string;
  txHash: string;
  logIndex: number;
  chainId: number;
  blockNumber: number;
  open: boolean;
  intent: {
    intentId: string;
    creator: string;
    inputToken: `0x${string}`;
    outputToken: `0x${string}`;
    inputAmount: string;
    minOutputAmount: string;
    deadline: string;
    allowPartialFill: boolean;
    srcChain: number;
    dstChain: number;
    srcAddress: `0x${string}`;
    dstAddress: `0x${string}`;
    solver: string;
    data: string;
  };
  events: unknown[];
}

/** Paginated list of intents created by a specific user wallet. */
export interface UserIntentsResponse {
  total: number;
  offset: number;
  limit: number;
  items: IntentResponse[];
}

/** Paginated snapshot of open swap intents currently awaiting solver execution. */
export interface OrderbookResponse {
  total: number;
  data: Array<{
    intentState: {
      exists: boolean;
      remainingInput: string;
      receivedOutput: string;
      pendingPayment: boolean;
    };
    intentData: {
      intentId: string;
      creator: string;
      inputToken: string;
      outputToken: string;
      inputAmount: string;
      minOutputAmount: string;
      deadline: string;
      allowPartialFill: boolean;
      srcChain: number;
      dstChain: number;
      srcAddress: string;
      dstAddress: string;
      solver: string;
      data: string;
      intentHash: string;
      txHash: string;
      blockNumber: number;
    };
  }>;
}

/** A user's current supply and borrow positions across all money market reserves. */
export interface MoneyMarketPosition {
  userAddress: string;
  positions: Array<{
    reserveAddress: string;
    aTokenAddress: string;
    variableDebtTokenAddress: string;
    aTokenBalance: string;
    variableDebtTokenBalance: string;
    blockNumber: number;
  }>;
}

/**
 * On-chain state for a single money market reserve asset, including aggregate
 * supply/borrow balances, current interest rates, and participant counts.
 * All numeric values are returned as decimal strings to avoid `bigint`
 * serialisation issues.
 */
export interface MoneyMarketAsset {
  reserveAddress: string;
  aTokenAddress: string;
  totalATokenBalance: string;
  variableDebtTokenAddress: string;
  totalVariableDebtTokenBalance: string;
  liquidityRate: string;
  symbol: string;
  totalSuppliers: number;
  totalBorrowers: number;
  variableBorrowRate: string;
  stableBorrowRate: string;
  liquidityIndex: string;
  variableBorrowIndex: string;
  blockNumber: number;
}

/** Paginated list of wallet addresses that currently hold an active borrow position against a specific reserve. */
export interface MoneyMarketAssetBorrowers {
  borrowers: string[];
  total: number;
  offset: number;
  limit: number;
}

/** Paginated list of wallet addresses that currently hold an active supply position in a specific reserve. */
export interface MoneyMarketAssetSuppliers {
  suppliers: string[];
  total: number;
  offset: number;
  limit: number;
}

/** Paginated list of all wallet addresses that hold an active borrow position across any money market reserve. */
export interface MoneyMarketBorrowers {
  borrowers: string[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * HTTP client for the SODAX backend API.
 *
 * Implements `IConfigApi` so that other services (e.g. `ConfigService`) can
 * fetch runtime chain/token configuration from the backend without being
 * coupled to a concrete HTTP implementation.
 *
 * Beyond configuration, the service exposes endpoints for:
 * - **Intents** — look up swap intents by transaction hash or intent hash.
 * - **Swaps** — submit a cross-chain swap transaction and poll its relay status.
 * - **Solver orderbook** — read open intents waiting to be filled.
 * - **Money market** — query per-user positions, per-reserve asset stats,
 *   and paginated borrower/supplier lists.
 *
 * All public methods return `Promise<Result<T>>` — they never throw. On
 * network failure, timeout, or a non-2xx HTTP response the returned Result
 * has `ok: false` with a descriptive `Error` in the `error` field.
 *
 * Per-call request overrides (base URL, timeout, headers) can be passed as
 * the optional last argument to any method via `RequestOverrideConfig`.
 */
export class BackendApiService implements IConfigApi {

  private readonly headers: Record<string, string>;

  constructor(private readonly config: ApiConfig) {
    this.headers = { ...config.headers };
  }

  /**
   * Execute a single HTTP request and return the parsed JSON body.
   *
   * Applies an `AbortController`-backed timeout (falls back to `this.config.timeout`
   * when `config.timeout` is absent). Throws on non-2xx status codes or when the
   * request exceeds the timeout, so callers should use {@link request} instead of
   * calling this directly.
   *
   * @throws `Error('HTTP_REQUEST_FAILED')` on non-2xx responses.
   * @throws `Error('REQUEST_TIMEOUT')` when the request exceeds the timeout.
   * @throws `Error('UNKNOWN_REQUEST_ERROR')` for any other unexpected failure.
   */
  private async makeRequest<T>(endpoint: string, config: RequestConfig): Promise<T> {
    const url = config.baseURL ? `${config.baseURL}${endpoint}` : `${this.config.baseURL}${endpoint}`;
    const headers = { ...this.headers, ...config.headers };

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeout = config.timeout ?? this.config.timeout;
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
        console.error('[BackendApiService] Request error:', error.message);
        throw error;
      }

      console.error('[BackendApiService] Unknown error:', error);
      throw new Error('UNKNOWN_REQUEST_ERROR', { cause: error });
    }
  }

  /**
   * Wraps {@link makeRequest} in a `Result<T>` so all errors are captured rather
   * than propagated as thrown exceptions. Every public endpoint method delegates
   * here instead of calling `makeRequest` directly.
   */
  private async request<T>(endpoint: string, config: RequestConfig): Promise<Result<T>> {
    try {
      const value = await this.makeRequest<T>(endpoint, config);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error };
    }
  }

  // Intent endpoints
  /**
   * Fetch a swap intent by the hub-chain transaction hash that created it.
   *
   * Intents are always created on the hub chain (Sonic), so `txHash` must
   * originate from that chain.
   *
   * @param txHash - The hub-chain transaction hash that emitted the intent creation event.
   * @returns `Result<IntentResponse>` — on success, the full intent details including
   *   open/closed state, token amounts, and any fill events.
   */
  public async getIntentByTxHash(txHash: string, config?: RequestOverrideConfig): Promise<Result<IntentResponse>> {
    return this.request<IntentResponse>(`/intent/tx/${txHash}`, { ...config, method: 'GET' });
  }

  /**
   * Fetch a swap intent by its canonical intent hash.
   *
   * @param intentHash - The unique identifier derived from the intent's on-chain data.
   * @returns `Result<IntentResponse>` — on success, the full intent details.
   */
  public async getIntentByHash(intentHash: string, config?: RequestOverrideConfig): Promise<Result<IntentResponse>> {
    return this.request<IntentResponse>(`/intent/${intentHash}`, { ...config, method: 'GET' });
  }

  // Swap submit-tx endpoints
  /**
   * Submit a signed spoke-chain swap transaction to the backend for processing.
   *
   * The backend relays the transaction to the hub chain, posts execution data
   * to the solver, and advances the intent through its lifecycle. The response
   * shape is validated at runtime via a type guard; an invalid shape is
   * returned as `{ ok: false }`.
   *
   * @param params - The signed transaction hash, source chain key, sender wallet
   *   address, intent data, and relay data required to process the swap.
   * @returns `Result<SubmitSwapTxResponse>` — on success, a confirmation object
   *   with `success: true` and a human-readable `message`.
   */
  public async submitSwapTx(
    params: SubmitSwapTxRequest,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitSwapTxResponse>> {
    const result = await this.request<unknown>('/swaps/submit-tx', {
      ...config,
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!result.ok) return result;
    if (!isSubmitSwapTxResponse(result.value)) {
      return { ok: false, error: new Error('Invalid submitSwapTx response: unexpected response shape') };
    }
    return { ok: true, value: result.value };
  }

  /**
   * Poll the backend relay pipeline for the current status of a previously
   * submitted swap transaction.
   *
   * Status progresses through: `pending` → `verifying` → `verified` →
   * `relaying` → `relayed` → `posting_execution` → `executed` (or `failed`).
   *
   * @param params - Object containing the source-chain transaction hash and,
   *   optionally, the source chain key to disambiguate cross-chain hashes.
   * @returns `Result<SubmitSwapTxStatusResponse>` — on success, includes the
   *   current `status`, any `failureReason`, and (once executed) the
   *   `dstIntentTxHash` on the hub chain.
   */
  public async getSubmitSwapTxStatus(
    params: GetSubmitSwapTxStatusParams,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitSwapTxStatusResponse>> {
    const queryParams = new URLSearchParams();
    queryParams.append('txHash', params.txHash);
    if (params.srcChainKey) queryParams.append('srcChainKey', params.srcChainKey);

    const endpoint = `/swaps/submit-tx/status?${queryParams.toString()}`;
    const result = await this.request<unknown>(endpoint, { ...config, method: 'GET' });
    if (!result.ok) return result;
    if (!isSubmitSwapTxStatusResponse(result.value)) {
      return { ok: false, error: new Error('Invalid submitSwapTxStatus response: unexpected response shape') };
    }
    return { ok: true, value: result.value };
  }

  // Solver endpoints
  /**
   * Fetch a paginated snapshot of the solver orderbook — open swap intents
   * that are currently waiting to be filled by the solver.
   *
   * @param params - Pagination cursor: `offset` (zero-based) and `limit` (page size), both as strings.
   * @returns `Result<OrderbookResponse>` — on success, the total count and an
   *   array of intent entries with their current fill state.
   */
  public async getOrderbook(
    params: { offset: string; limit: string },
    config?: RequestOverrideConfig,
  ): Promise<Result<OrderbookResponse>> {
    const queryParams = new URLSearchParams();
    queryParams.append('offset', params.offset);
    queryParams.append('limit', params.limit);

    const queryString = queryParams.toString();
    const endpoint = `/solver/orderbook?${queryString}`;

    return this.request<OrderbookResponse>(endpoint, { ...config, method: 'GET' });
  }

  /**
   * Fetch all swap intents created by a specific wallet address, with optional
   * date-range filtering and pagination.
   *
   * `startDate` and `endDate` are Unix timestamps in **milliseconds**; the
   * backend converts them to ISO-8601 strings internally.
   *
   * @param params.userAddress - The user's hub-chain wallet address.
   * @param params.startDate - Optional lower bound for the intent creation time (ms since epoch).
   * @param params.endDate - Optional upper bound for the intent creation time (ms since epoch).
   * @param params.limit - Optional maximum number of results to return (as a string).
   * @param params.offset - Optional zero-based pagination offset (as a string).
   * @returns `Result<UserIntentsResponse>` — on success, a paginated list of the
   *   user's intent history with `total`, `offset`, `limit`, and `items`.
   */
  public async getUserIntents(
    params: {
      userAddress: Address;
      startDate?: number;
      endDate?: number;
      limit?: string;
      offset?: string;
    },
    config?: RequestOverrideConfig,
  ): Promise<Result<UserIntentsResponse>> {
    const { userAddress, startDate, endDate, limit, offset } = params;
    const queryParams = new URLSearchParams();
    if (startDate) queryParams.append('startDate', new Date(startDate).toISOString());
    if (endDate) queryParams.append('endDate', new Date(endDate).toISOString());
    if (limit) queryParams.append('limit', limit);
    if (offset) queryParams.append('offset', offset);

    const queryString = queryParams.toString();
    const endpoint =
      queryString.length > 0 ? `/intent/user/${userAddress}?${queryString}` : `/intent/user/${userAddress}`;

    return this.request<UserIntentsResponse>(endpoint, { ...config, method: 'GET' });
  }

  // Money Market endpoints
  /**
   * Fetch the current money market position for a wallet address.
   *
   * Returns all reserves in which the user holds aTokens (supplied collateral)
   * or variable-debt tokens (outstanding borrows), together with their
   * on-chain balances and the block number at which the snapshot was taken.
   *
   * @param userAddress - The wallet address to query.
   * @returns `Result<MoneyMarketPosition>` — on success, the user's aggregate
   *   position across all active reserves.
   */
  public async getMoneyMarketPosition(
    userAddress: string,
    config?: RequestOverrideConfig,
  ): Promise<Result<MoneyMarketPosition>> {
    return this.request<MoneyMarketPosition>(`/moneymarket/position/${userAddress}`, { ...config, method: 'GET' });
  }

  /**
   * Fetch the on-chain state for every active money market reserve asset.
   *
   * @returns `Result<MoneyMarketAsset[]>` — on success, an array of reserve
   *   snapshots including interest rates, liquidity indices, and participant counts.
   */
  public async getAllMoneyMarketAssets(config?: RequestOverrideConfig): Promise<Result<MoneyMarketAsset[]>> {
    return this.request<MoneyMarketAsset[]>('/moneymarket/asset/all', { ...config, method: 'GET' });
  }

  /**
   * Fetch the on-chain state for a single money market reserve asset.
   *
   * @param reserveAddress - The reserve contract address (EVM `0x…` format).
   * @returns `Result<MoneyMarketAsset>` — on success, the reserve snapshot
   *   including interest rates, total balances, and liquidity indices.
   */
  public async getMoneyMarketAsset(reserveAddress: string, config?: RequestOverrideConfig): Promise<Result<MoneyMarketAsset>> {
    return this.request<MoneyMarketAsset>(`/moneymarket/asset/${reserveAddress}`, { ...config, method: 'GET' });
  }

  /**
   * Fetch a paginated list of wallets that currently have an outstanding borrow
   * against a specific reserve.
   *
   * @param reserveAddress - The reserve contract address to query.
   * @param params - Pagination cursor: `offset` (zero-based) and `limit` (page size), both as strings.
   * @returns `Result<MoneyMarketAssetBorrowers>` — on success, the borrower addresses
   *   and pagination metadata (`total`, `offset`, `limit`).
   */
  public async getMoneyMarketAssetBorrowers(
    reserveAddress: string,
    params: { offset: string; limit: string },
    config?: RequestOverrideConfig,
  ): Promise<Result<MoneyMarketAssetBorrowers>> {
    const queryParams = new URLSearchParams();
    queryParams.append('offset', params.offset);
    queryParams.append('limit', params.limit);

    const queryString = queryParams.toString();
    const endpoint = `/moneymarket/asset/${reserveAddress}/borrowers?${queryString}`;

    return this.request<MoneyMarketAssetBorrowers>(endpoint, { ...config, method: 'GET' });
  }

  /**
   * Fetch a paginated list of wallets that currently have an active supply
   * (aToken balance) in a specific reserve.
   *
   * @param reserveAddress - The reserve contract address to query.
   * @param params - Pagination cursor: `offset` (zero-based) and `limit` (page size), both as strings.
   * @returns `Result<MoneyMarketAssetSuppliers>` — on success, the supplier addresses
   *   and pagination metadata (`total`, `offset`, `limit`).
   */
  public async getMoneyMarketAssetSuppliers(
    reserveAddress: string,
    params: { offset: string; limit: string },
    config?: RequestOverrideConfig,
  ): Promise<Result<MoneyMarketAssetSuppliers>> {
    const queryParams = new URLSearchParams();
    queryParams.append('offset', params.offset);
    queryParams.append('limit', params.limit);

    const queryString = queryParams.toString();
    const endpoint = `/moneymarket/asset/${reserveAddress}/suppliers?${queryString}`;

    return this.request<MoneyMarketAssetSuppliers>(endpoint, { ...config, method: 'GET' });
  }

  /**
   * Fetch a paginated list of all wallet addresses that hold an active borrow
   * position across any money market reserve.
   *
   * @param params - Pagination cursor: `offset` (zero-based) and `limit` (page size), both as strings.
   * @returns `Result<MoneyMarketBorrowers>` — on success, the borrower addresses
   *   and pagination metadata (`total`, `offset`, `limit`).
   */
  public async getAllMoneyMarketBorrowers(
    params: { offset: string; limit: string },
    config?: RequestOverrideConfig,
  ): Promise<Result<MoneyMarketBorrowers>> {
    const queryParams = new URLSearchParams();
    queryParams.append('offset', params.offset);
    queryParams.append('limit', params.limit);

    const queryString = queryParams.toString();
    const endpoint = `/moneymarket/borrowers?${queryString}`;

    return this.request<MoneyMarketBorrowers>(endpoint, { ...config, method: 'GET' });
  }

  /**
   * Fetch the complete SODAX runtime configuration in a single request.
   *
   * The response bundles the full `SodaxConfig` (chain configs, token lists,
   * contract addresses, etc.) along with an optional schema version number.
   * `ConfigService` calls this method as its primary configuration source.
   *
   * @returns `Result<GetAllConfigApiResponse>` — on success, `{ version?, config }` where
   *   `config` is the current `SodaxConfig` used by all SDK services.
   */
  public async getAllConfig(config?: RequestOverrideConfig): Promise<Result<GetAllConfigApiResponse>> {
    return this.request<GetAllConfigApiResponse>('/config/all', { ...config, method: 'GET' });
  }

  /**
   * Fetch the list of spoke chain keys that are currently supported by the
   * SODAX protocol.
   *
   * Required by `IConfigApi`. Used by `ConfigService` to discover which chains
   * are available before building chain-specific service configurations.
   *
   * @returns `Result<GetChainsApiResponse>` — on success, a readonly array of
   *   `SpokeChainKey` strings (e.g. `["ethereum", "arbitrum", "solana", …]`).
   */
  public async getChains(config?: RequestOverrideConfig): Promise<Result<GetChainsApiResponse>> {
    return this.request<GetChainsApiResponse>('/config/spoke/chains', { ...config, method: 'GET' });
  }

  /**
   * Fetch the full map of tokens available for swapping, keyed by spoke chain.
   *
   * Required by `IConfigApi`. The response is a `Record<SpokeChainKey, readonly XToken[]>`
   * covering all chains. Use `getSwapTokensByChainId` to narrow to a single chain.
   *
   * @returns `Result<GetSwapTokensApiResponse>` — on success, a map from each
   *   supported spoke chain key to its list of swappable `XToken` definitions.
   */
  public async getSwapTokens(config?: RequestOverrideConfig): Promise<Result<GetSwapTokensApiResponse>> {
    return this.request<GetSwapTokensApiResponse>('/config/swap/tokens', { ...config, method: 'GET' });
  }

  /**
   * Fetch the list of tokens available for swapping on a specific spoke chain.
   *
   * Required by `IConfigApi`.
   *
   * @param chainId - The spoke chain key to query (e.g. `"ethereum"`, `"solana"`).
   * @returns `Result<GetSwapTokensByChainIdApiResponse>` — on success, a readonly
   *   array of `XToken` definitions supported for swapping on that chain.
   */
  public async getSwapTokensByChainId(
    chainId: SpokeChainKey,
    config?: RequestOverrideConfig,
  ): Promise<Result<GetSwapTokensByChainIdApiResponse>> {
    return this.request<GetSwapTokensByChainIdApiResponse>(`/config/swap/${chainId}/tokens`, {
      ...config,
      method: 'GET',
    });
  }

  /**
   * Fetch the full map of tokens available in the money market (lending/borrowing),
   * keyed by spoke chain.
   *
   * Required by `IConfigApi`.
   *
   * @returns `Result<GetMoneyMarketTokensApiResponse>` — on success, a map from
   *   each supported spoke chain key to its list of money-market `XToken` definitions.
   */
  public async getMoneyMarketTokens(config?: RequestOverrideConfig): Promise<Result<GetMoneyMarketTokensApiResponse>> {
    return this.request<GetMoneyMarketTokensApiResponse>('/config/money-market/tokens', {
      ...config,
      method: 'GET',
    });
  }

  /**
   * Fetch the list of hub-chain reserve asset addresses registered in the
   * money market protocol.
   *
   * Reserve addresses are the on-chain contract addresses (EVM `0x…` format)
   * for each lending pool. They are used to key into per-reserve queries such
   * as `getMoneyMarketAsset` and `getMoneyMarketAssetBorrowers`.
   *
   * @returns `Result<GetMoneyMarketReserveAssetsApiResponse>` — on success, a
   *   readonly array of reserve `Address` strings.
   */
  public async getMoneyMarketReserveAssets(
    config?: RequestOverrideConfig,
  ): Promise<Result<GetMoneyMarketReserveAssetsApiResponse>> {
    return this.request<GetMoneyMarketReserveAssetsApiResponse>('/config/money-market/reserve-assets', {
      ...config,
      method: 'GET',
    });
  }

  /**
   * Fetch the list of tokens available for lending/borrowing on a specific
   * spoke chain.
   *
   * Required by `IConfigApi`.
   *
   * @param chainId - The spoke chain key to query (e.g. `"ethereum"`, `"arbitrum"`).
   * @returns `Result<GetMoneyMarketTokensByChainIdApiResponse>` — on success, a
   *   readonly array of `XToken` definitions supported in the money market on that chain.
   */
  public async getMoneyMarketTokensByChainId(
    chainId: SpokeChainKey,
    config?: RequestOverrideConfig,
  ): Promise<Result<GetMoneyMarketTokensByChainIdApiResponse>> {
    return this.request<GetMoneyMarketTokensByChainIdApiResponse>(
      `/config/money-market/${chainId}/tokens`,
      { ...config, method: 'GET' },
    );
  }

  /**
   * Fetch the mapping from spoke chain keys to the numeric chain IDs used by
   * the intent relay protocol.
   *
   * The relay chain ID map is consumed by `IntentRelayApiService` to translate
   * between SDK chain keys and the numeric identifiers expected by the relay
   * smart contracts and the solver.
   *
   * @returns `Result<GetRelayChainIdMapApiResponse>` — on success, an
   *   `IntentRelayChainIdMap` record mapping each spoke chain key to its relay chain ID.
   */
  public async getRelayChainIdMap(config?: RequestOverrideConfig): Promise<Result<GetRelayChainIdMapApiResponse>> {
    return this.request<GetRelayChainIdMapApiResponse>('/config/relay/chain-id-map', {
      ...config,
      method: 'GET',
    });
  }

  /**
   * Fetch the full chain configuration for all supported spoke chains.
   *
   * The response is a `SpokeChainConfigMap` — a record keyed by `SpokeChainKey`
   * where each entry describes the spoke contracts, asset contracts, and
   * chain-level parameters (e.g. RPC URLs, decimals, icon symbol) for that chain.
   * `ConfigService` uses this to populate per-chain spoke provider configurations.
   *
   * @returns `Result<GetSpokeChainConfigApiResponse>` — on success, the full
   *   `SpokeChainConfigMap` for all currently enabled spoke chains.
   */
  public async getSpokeChainConfig(config?: RequestOverrideConfig): Promise<Result<GetSpokeChainConfigApiResponse>> {
    return this.request<GetSpokeChainConfigApiResponse>('/config/spoke/all-chains-configs', {
      ...config,
      method: 'GET',
    });
  }

  /**
   * Merge additional headers into the service's default header set.
   *
   * Useful for injecting authentication tokens or tracing headers at runtime
   * without constructing a new service instance. Existing header keys are
   * overwritten; keys absent from `headers` are preserved.
   *
   * @param headers - Key-value pairs to add or overwrite in the default headers.
   */
  public setHeaders(headers: Record<string, string>): void {
    Object.entries(headers).forEach(([key, value]) => {
      this.headers[key] = value;
    });
  }

  /**
   * Return the base URL the service is currently pointing at.
   *
   * @returns The `baseURL` from the `ApiConfig` this instance was constructed with.
   */
  public getBaseURL(): string {
    return this.config.baseURL;
  }
}
