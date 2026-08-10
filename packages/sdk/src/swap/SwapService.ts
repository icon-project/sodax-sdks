import { invariant } from '../shared/utils/tiny-invariant.js';
import {
  submitTransaction,
  waitUntilIntentExecuted,
  SonicSpokeService,
  type SpokeService,
  adjustAmountByFee,
  calculateFeeAmount,
  calculatePercentageFeeAmount,
  encodeContractCalls,
  isSonicChainKeyType,
  type EstimateGasParams,
  type ConfigService,
  type HubProvider,
  type GetRelayResponse,
  type IntentDeliveryInfo,
  type IntentRelayRequest,
  type PacketData,
  isBitcoinChainKeyType,
  isHubChainKeyType,
  reverseEncodeAddress,
  type SendMessageParams,
  type SpokeIsAllowanceValidParamsEvmSpoke,
  type SpokeIsAllowanceValidParamsHub,
  type SpokeIsAllowanceValidParamsStellar,
  isEvmSpokeOnlyChainKeyType,
  isStellarChainKeyType,
  isUndefinedOrValidWalletProviderForChainKey,
  relayTxAndWaitPacket,
  isOptionalEvmWalletProviderType,
  isOptionalStellarWalletProviderType,
  isBitcoinWalletProviderType,
  type RelayExtraData,
  type TxHashPair,
  isStacksChainKeyType,
  isNativeBitcoinTransfer,
  RELAY_FALLBACK_FLOOR_MS,
} from '../shared/index.js';
import { SolverApiService } from './SolverApiService.js';
import { EvmSolverService } from './EvmSolverService.js';
import type { BackendApiService } from '../backendApi/index.js';
import { runBackendSubmitTx } from '../backendApi/runBackendSubmitTx.js';
import { createSubmitTxAttempt, type SubmitTxAttempt } from '../backendApi/submitTxAttempt.js';
import { resolveTimeoutMs } from '../shared/utils/resolveTimeoutMs.js';
import type { ApprovalTxs } from '../shared/types/spoke-types.js';
import { selectSolvedIntentPacket } from './selectSolvedIntentPacket.js';
import { SodaxError } from '../errors/SodaxError.js';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import {
  verifyFailed,
  intentCreationFailed,
  executionFailed,
  unknownFailed,
  approveFailed,
} from '../errors/wrappers.js';
import {
  type SwapCreateIntentError,
  type PostExecutionError,
  type SwapError,
  isSwapCreateIntentError,
  isPostExecutionError,
  isSwapError,
  swapInvariant,
} from './errors.js';
export type {
  CreateIntentParams,
  CreateLimitOrderParams,
  Intent,
  FeeData,
  IntentData,
  IntentState,
  SwapExtras,
  BitcoinBoundExtras,
} from '../shared/types/intent-types.js';
export { IntentDataType } from '../shared/types/intent-types.js';
import type {
  CreateIntentParams,
  CreateLimitOrderParams,
  Intent,
  IntentState,
  SwapExtras,
} from '../shared/types/intent-types.js';
import {
  type SpokeChainKey,
  type Hex,
  type Hash,
  type HttpUrl,
  getIntentRelayChainId,
  type FeeAmount,
  type GetWalletProviderType,
  type PartnerFee,
  type SolverErrorResponse,
  type SolverExecutionRequest,
  type SolverExecutionResponse,
  type SolverIntentQuoteRequest,
  type SolverIntentQuoteResponse,
  type SolverIntentStatusRequest,
  type SolverIntentStatusResponse,
  type Result,
  type TxReturnType,
  type GetEstimateGasReturnType,
  type SolverConfig,
  type XToken,
  HUB_CHAIN_KEY,
  isHubChainKey,
  DEFAULT_RELAY_TX_TIMEOUT,
  DEFAULT_DEADLINE_OFFSET,
  type GetAddressType,
  type GetTokenAddressType,
  type HubChainKey,
  type EvmSpokeOnlyChainKey,
  type StellarChainKey,
  type SpokeExecActionParams,
  type SonicChainKey,
  BITCOIN_DUST_SATS,
} from '@sodax/types';

export type GetIntentSubmitTxExtraDataParams = { txHash: Hash } | { intent: Intent };

export type SwapResponse = {
  solverExecutionResponse: SolverExecutionResponse;
  intent: Intent;
  intentDeliveryInfo: IntentDeliveryInfo;
};

export type CreateIntentResult<K extends SpokeChainKey, Raw extends boolean> = {
  tx: TxReturnType<K, Raw>;
  intent: Intent & FeeAmount;
  relayData: RelayExtraData;
};

// Exec-mode params: walletProvider is required and K-narrowed. Consumed by `createIntent`,
// `createLimitOrder`, `createLimitOrderIntent`, `approve` — methods that send a transaction
// and return an executed tx hash.
export type SwapActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  CreateIntentParams<K>,
  SwapExtras<K>
>;

export type LimitOrderActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  CreateLimitOrderParams<K>,
  SwapExtras<K>
>;

/**
 * Params for `cancelIntent`.
 * Because `Intent.srcChain` is an `IntentRelayChainId` (bigint) whose literal type cannot
 * narrow to a specific ChainKey, the user passes `srcChainKey: K` explicitly. At runtime we
 * assert that `getIntentRelayChainId(srcChainKey) === intent.srcChain` and throw if not.
 */
export type CancelIntentParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  intent: Intent;
  skipSimulation?: boolean;
  timeout?: number;
};

export type CancelIntentActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  CancelIntentParams<K>
>;

// Non-breaking superset of `SolverIntentQuoteRequest`: existing `getQuote(payload)` calls keep
// working unchanged. `partnerFee` is an optional per-call override (matches `extras.partnerFee` on
// createIntent/swap); it is stripped before the request is forwarded to the solver.
export type GetQuoteParams = SolverIntentQuoteRequest & {
  /** Optional per-call override of the configured swap partner fee. Falls back to config when omitted. */
  partnerFee?: PartnerFee;
};

export type SwapServiceConstructorParams = {
  config: ConfigService;
  spoke: SpokeService;
  hubProvider: HubProvider;
  backendApi: BackendApiService;
};

/**
 * Main entry point for the SODAX swap feature.
 *
 * Implements the intent-based solver architecture: the user creates a `SwapIntent` on their
 * source spoke chain, which is relayed to the Sonic hub where the solver picks it up and
 * delivers the output tokens on the destination chain.
 *
 * Responsibilities:
 * - Building and submitting swap/limit-order intents on any supported spoke chain
 * - Querying quotes and intent status from the solver API
 * - Approving token spend on behalf of the intent system
 * - Cancelling active intents (limit orders)
 * - Waiting for cross-chain relay delivery confirmations
 *
 * Consumers should access this service through the `Sodax` facade: `sodax.swaps`.
 */
export class SwapService {
  // dependent services
  readonly hubProvider: HubProvider;
  readonly config: ConfigService;
  readonly spoke: SpokeService;

  // swap config
  readonly solver: SolverConfig;
  readonly relayerApiEndpoint: HttpUrl;

  // backend swaps-API client
  readonly backendApi: BackendApiService;

  /**
   * Effective 2-step submit-tx flow (`swaps.useBackendSubmitTx`, default on). Read live off
   * `ConfigService`, like {@link SwapService.partnerFee}, so the config object and the behavior can
   * never disagree.
   */
  get useBackendSubmitTx(): boolean {
    return this.config.swapUseBackendSubmitTx;
  }

  /**
   * Effective swap partner fee (`swaps.partnerFee`, else the global `fee`). Read live off
   * `ConfigService` rather than snapshotted in the constructor, so it cannot diverge from
   * `config.swapPartnerFee` if the config object is ever replaced (see `ConfigService.initialize`).
   * `BridgeService` and `LeverageYieldService` resolve their fees the same way.
   */
  get partnerFee(): PartnerFee | undefined {
    return this.config.swapPartnerFee;
  }

  public constructor({ config, hubProvider, spoke, backendApi }: SwapServiceConstructorParams) {
    this.solver = config.solver;
    this.relayerApiEndpoint = config.relay.relayerApiEndpoint;
    this.config = config;
    this.hubProvider = hubProvider;
    this.spoke = spoke;
    this.backendApi = backendApi;
  }

  /**
   * Estimates the gas cost for a raw (unsigned) transaction on a spoke chain.
   *
   * @param params - Chain key plus the raw transaction data to simulate.
   * @returns A `Result` wrapping the chain-specific gas estimate (`GetEstimateGasReturnType<C>`).
   */
  public async estimateGas<C extends SpokeChainKey>(
    params: EstimateGasParams<C>,
  ): Promise<Result<GetEstimateGasReturnType<C>>> {
    return this.spoke.estimateGas(params) as Promise<Result<GetEstimateGasReturnType<C>>>;
  }

  /**
   * Requests a price quote from the solver API for a given token pair and amount.
   *
   * Adjusts `payload.amount` by the partner fee before forwarding to the solver, so the returned
   * `quoted_amount` reflects the net output the user actually receives. Pass `partnerFee` to match
   * a per-action override supplied to `createIntent` (`extras.partnerFee`); omit it to use the
   * configured swap fee.
   *
   * @param payload - The solver quote request, optionally carrying a per-call `partnerFee` override
   *   (defaults to the configured swap partner fee). `partnerFee` is stripped before forwarding.
   * @returns A `Result` containing `{ quoted_amount: bigint }` on success, or a
   *   `SolverErrorResponse` (with a `SolverIntentErrorCode`) on failure.
   *
   * @example
   * const response = await swapService.getQuote({
   *   token_src: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
   *   token_dst: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
   *   token_src_blockchain_id: '0x38.bsc',
   *   token_dst_blockchain_id: '0xa4b1.arbitrum',
   *   amount: 1000000000000000n,
   *   quote_type: 'exact_input',
   * });
   * if (response.ok) console.log('Quoted amount:', response.value.quoted_amount);
   */
  public async getQuote(payload: GetQuoteParams): Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse>> {
    const { partnerFee = this.partnerFee, ...request } = payload;
    const adjustedPayload = {
      ...request,
      amount: adjustAmountByFee(request.amount, partnerFee, request.quote_type),
    } satisfies SolverIntentQuoteRequest;
    return SolverApiService.getQuote(adjustedPayload, this.solver, this.config);
  }

  /**
   * Calculates the partner fee that will be deducted from the given input amount.
   *
   * Returns `0n` when no partner fee is configured on this service instance.
   *
   * @param inputAmount - Gross input token amount (in token's smallest unit).
   * @returns The fee amount denominated in the input token. `0n` if no fee is configured.
   */
  public getPartnerFee(inputAmount: bigint): bigint {
    if (!this.partnerFee) {
      return 0n;
    }

    return calculateFeeAmount(inputAmount, this.partnerFee);
  }

  /**
   * Calculates the fixed 0.1% solver protocol fee for a given input amount.
   *
   * @param inputAmount - Gross input token amount (in token's smallest unit).
   * @returns The solver fee amount denominated in the input token (10 basis points of `inputAmount`).
   */
  public getSolverFee(inputAmount: bigint): bigint {
    return calculatePercentageFeeAmount(inputAmount, 10);
  }

  /**
   * Polls the solver API for the current execution status of an intent.
   *
   * The `intent_tx_hash` in the request must be the hub-chain (Sonic) transaction hash where
   * the intent was registered — this is the `dst_tx_hash` from the relay packet returned by
   * `swap()` or `relayTxAndWaitPacket`.
   *
   * @param request - Object containing `intent_tx_hash` (the hub-chain tx hash).
   * @returns A `Result` containing `{ status: SolverIntentStatusCode, fill_tx_hash?: string }`.
   *   `fill_tx_hash` is populated only when `status === SolverIntentStatusCode.SOLVED (3)`.
   */
  public async getStatus(
    request: SolverIntentStatusRequest,
  ): Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>> {
    return SolverApiService.getStatus(request, this.solver, this.config.logger);
  }

  /**
   * Notifies the solver API that an intent has been registered on the hub chain, triggering
   * the solver to begin filling it.
   *
   * Called automatically by `swap()` after the cross-chain relay packet lands on the hub. You
   * only need to call this manually when orchestrating the swap steps yourself.
   *
   * @param request - Object containing `intent_tx_hash` — the hub-chain tx where the intent was created.
   * @returns A `Result<SolverExecutionResponse, PostExecutionError>`. On failure `result.error` is a
   *   {@link SodaxError} with one of:
   *   - `EXTERNAL_API_ERROR` — solver returned a typed error response. The original
   *     `SolverIntentErrorCode` is on `result.error.context.solverCode`; the full
   *     `SolverErrorResponse.detail` is on `result.error.context.solverDetail`.
   *   - `EXECUTION_FAILED` — network/transport-level failure (the solver call threw).
   *   - `UNKNOWN` — defensive fallback; should not normally hit.
   *
   *   By design, `postExecution` alone never emits relay/verify codes — those appear only on
   *   `swap` because only `swap` orchestrates verify + relay.
   */
  public async postExecution(
    request: SolverExecutionRequest,
  ): Promise<Result<SolverExecutionResponse, PostExecutionError>> {
    try {
      const result = await SolverApiService.postExecution(request, this.solver, this.config.logger);
      if (result.ok) return result;

      // Defensive: SolverApiService is contractually typed to return SolverErrorResponse,
      // but a malformed upstream payload would otherwise surface as a cryptic
      // "Cannot read properties of undefined" caught below. Fall back to a synthetic detail
      // so the canonical SodaxError carries enough context for forensics.
      const detail = result.error?.detail ?? {
        code: -999, // SolverIntentErrorCode.UNKNOWN
        message: 'Solver returned malformed error response',
      };
      return {
        ok: false,
        error: new SodaxError('EXTERNAL_API_ERROR', detail.message, {
          feature: 'swap',
          context: {
            phase: 'postExecution',
            api: 'solver',
            solverCode: detail.code,
            solverDetail: detail,
          },
        }),
      };
    } catch (error) {
      // Narrow guard: only preserve SodaxErrors whose code is in postExecution's union.
      // A SodaxError with an out-of-union code (e.g. RELAY_TIMEOUT) is wrapped below
      // as EXECUTION_FAILED so the typed contract holds at runtime.
      if (isPostExecutionError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('swap', error, { phase: 'postExecution' }) };
    }
  }

  /**
   * Submits a spoke-chain transaction to the relayer API so it is tracked and relayed to the hub.
   *
   * Called automatically by `swap()`. Use this directly when you need manual control over the
   * relay lifecycle (e.g. you called `createIntent` separately and want to relay yourself).
   *
   * @param submitPayload - Relay request with `action: 'submit'`, containing `chain_id` and `tx_hash`.
   * @returns A `Result` wrapping the relay submission acknowledgement.
   */
  public async submitIntent(submitPayload: IntentRelayRequest<'submit'>): Promise<Result<GetRelayResponse<'submit'>>> {
    try {
      return await submitTransaction(submitPayload, this.relayerApiEndpoint);
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Executes a full end-to-end cross-chain swap.
   *
   * Orchestrates the complete swap lifecycle. `createIntent` first submits the intent transaction on
   * the source spoke chain; completion then runs via one of two paths, each bounded by its own `timeout`
   * budget:
   *
   * - **Client-side (opt-out via `swaps.useBackendSubmitTx: false`), {@link fallbackSwapSteps}:** verifies
   *   the spoke tx landed on-chain, relays it to the hub (Sonic) and waits for the packet — skipped when
   *   `srcChainKey` is the hub, where the spoke tx already is the hub tx — then calls `postExecution` to
   *   notify the solver, triggering it to fill the intent.
   * - **Backend 2-step (default via `swaps.useBackendSubmitTx`), {@link submitTx}:** hands the
   *   broadcast tx to the swaps API, which verifies, relays and post-executes server-side, then polls
   *   for completion. On ANY non-success it transparently falls back to the client-side path above —
   *   safe because re-relaying / re-posting an already-processed swap is idempotent (no double-fill).
   *
   * @param _params - Swap action params including intent parameters, wallet provider, and an optional
   *   `timeout` — a PER-ATTEMPT budget, not an end-to-end one. The backend attempt (submit POST + status
   *   poll) gets it, and if that attempt does not complete the client-side relay wait gets a fresh one
   *   starting after verification, so neither a stalled backend nor a slow source-chain confirmation can
   *   shorten it. Worst-case wall-clock is `createIntent + timeout + verification +
   *   max(timeout, RELAY_FALLBACK_FLOOR_MS) + postExecution`, where verification is bounded by the source
   *   chain's `pollingConfig.maxTimeoutMs` and the first and last terms are not bounded by `timeout` at
   *   all. See `docs/SWAPS.md` § How `timeout` bounds each attempt.
   * @returns A `Result<SwapResponse, SwapError>`. On success:
   *   - `solverExecutionResponse` — solver acknowledgement (`{ answer: 'OK', intent_hash }`).
   *   - `intent` — the on-chain intent object that was created.
   *   - `intentDeliveryInfo` — source/destination chain keys, tx hashes, and user addresses.
   *
   *   On failure `result.error` is a {@link SodaxError} with one of:
   *   - `VALIDATION_FAILED` — input validation failed (propagated from `createIntent`).
   *   - `INTENT_CREATION_FAILED` — spoke-side intent creation/deposit failed.
   *   - `TX_VERIFICATION_FAILED` — the spoke tx could not be verified on-chain.
   *   - `TX_SUBMIT_FAILED` — relay submission failed after the spoke tx landed
   *     (`context.relayCode === 'SUBMIT_TX_FAILED'`).
   *   - `RELAY_TIMEOUT` — relay packet did not arrive in time
   *     (`context.relayCode === 'RELAY_TIMEOUT'`).
   *   - `RELAY_FAILED` — other relay failure (`context.relayCode === 'UNKNOWN'`).
   *   - `EXECUTION_FAILED` — solver notify call failed.
   *   - `EXTERNAL_API_ERROR` — solver returned a typed error
   *     (`context.solverCode` carries the original `SolverIntentErrorCode`).
   *   - `UNKNOWN` — uncategorized fallback.
   */
  public async swap<K extends SpokeChainKey>(
    _params: SwapActionParams<K, false>,
  ): Promise<Result<SwapResponse, SwapError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey };
    return this.config.analytics.trackResult(
      'swap',
      'swap',
      async () => {
        try {
          const createIntentResult = await this.createIntent(_params);
          if (!createIntentResult.ok) {
            // CreateIntentErrorCode ⊂ SwapErrorCode by definition; the cast is structural, not a
            // contract widening. (Verified at design time via the type alias relationship.)
            return { ok: false, error: createIntentResult.error };
          }

          const created = createIntentResult.value;

          // `timeout` is a PER-ATTEMPT budget, not an end-to-end one: the backend attempt gets it, and if
          // that attempt fails the client-side relay fallback gets a fresh one. Sharing a single deadline
          // would leave the fallback whatever the backend had not spent, which is how a relay that needs
          // longer than the leftovers ends in RELAY_TIMEOUT. Resolved (not just defaulted) so a non-finite
          // caller value cannot reach either budget — see `resolveTimeoutMs`.
          const timeoutMs = resolveTimeoutMs(_params.timeout, DEFAULT_RELAY_TX_TIMEOUT);

          // Backend 2-step flow (default on): hand the broadcast intent tx to the swaps API, which relays +
          // post-executes server-side. On ANY non-success we fall back to the client-side relay so the
          // swap still completes — safe because re-relay / re-post are idempotent (see `submitTx`).
          if (this.useBackendSubmitTx) {
            const submitted = await this.submitTx(_params, created, createSubmitTxAttempt(timeoutMs));
            if (submitted.ok) return submitted;
            this.config.logger.warn(
              '[swap] backend submit-tx did not complete; falling back to the client-side relay',
              {
                error: submitted.error,
              },
            );
          }

          return this.fallbackSwapSteps(_params, created, timeoutMs);
        } catch (error) {
          // Narrow guard: preserve SodaxErrors whose code is in the swap union; wrap unknown
          // codes (e.g. an accidental cross-feature code) as UNKNOWN.
          if (isSwapError(error)) return { ok: false, error };
          return {
            ok: false,
            error: unknownFailed('swap', error, { ...baseCtx, action: 'swap' }),
          };
        }
      },
      {
        start: () => ({
          srcChainKey,
          dstChainKey: params.dstChainKey,
          srcAddress: params.srcAddress,
          dstAddress: params.dstAddress,
        }),
        success: value => ({
          srcChainKey,
          dstChainKey: params.dstChainKey,
          srcTxHash: value.intentDeliveryInfo.srcTxHash,
          dstTxHash: value.intentDeliveryInfo.dstTxHash,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Client-side swap completion (opt-out via `swaps.useBackendSubmitTx: false`): verify the broadcast intent
   * tx landed, then relay it to the hub — or use it directly when the source IS the hub — then notify the
   * solver via post-execution and build the {@link SwapResponse}. Extracted verbatim from `swap()` so the
   * backend 2-step path ({@link submitTx}) can fall back to it on any non-success.
   *
   * Verification belongs to THIS path only: the backend runs its own, so verifying before handing over
   * would delay every backend success by the source chain's confirmation wait and could fail a swap the
   * backend would have completed.
   */
  private async fallbackSwapSteps<K extends SpokeChainKey>(
    _params: SwapActionParams<K, false>,
    created: CreateIntentResult<K, false>,
    timeoutMs: number,
  ): Promise<Result<SwapResponse, SwapError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey };
    const { tx: spokeTxHash, intent, relayData } = created;

    const verifyTxHashResult = await this.spoke.verifyTxHash({
      txHash: created.tx,
      chainKey: srcChainKey,
    });
    if (!verifyTxHashResult.ok) {
      return { ok: false, error: verifyFailed('swap', verifyTxHashResult.error, { ...baseCtx, action: 'swap' }) };
    }

    let dstIntentTxHash: string;
    if (isHubChainKeyType(srcChainKey)) {
      dstIntentTxHash = spokeTxHash;
    } else {
      const packet = await relayTxAndWaitPacket({
        srcTxHash: spokeTxHash,
        data: relayData,
        chainKey: srcChainKey,
        relayerApiEndpoint: this.relayerApiEndpoint,
        // The caller's full `timeout`, starting HERE — after verification, and whether this runs as the
        // only path or as the backend's fallback. Neither a stalled backend attempt nor a slow source-chain
        // confirmation may shorten the relay wait. The floor covers a sub-floor caller `timeout`:
        // `relayTxAndWaitPacket` SUBMITS before `timeout` bounds anything, so a zero budget would strand an
        // already-landed tx unrelayed. Re-relay is idempotent, so spending it is safe.
        timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),
      });
      if (!packet.ok) {
        return { ok: false, error: mapRelayFailure(packet.error, { feature: 'swap', action: 'swap', ...baseCtx }) };
      }
      dstIntentTxHash = packet.value.dst_tx_hash;
    }

    const postExecResult = await this.postExecution({
      intent_tx_hash: dstIntentTxHash as `0x${string}`,
    });
    if (!postExecResult.ok) {
      // PostExecutionErrorCode ⊂ SwapErrorCode by definition.
      return { ok: false, error: postExecResult.error };
    }

    return {
      ok: true,
      value: {
        solverExecutionResponse: postExecResult.value,
        intent,
        intentDeliveryInfo: {
          srcChainKey,
          srcTxHash: spokeTxHash,
          srcAddress: params.srcAddress,
          dstChainKey: params.dstChainKey,
          dstTxHash: dstIntentTxHash,
          dstAddress: params.dstAddress,
        } satisfies IntentDeliveryInfo,
      },
    };
  }

  /**
   * Backend 2-step swap path (default via `swaps.useBackendSubmitTx`): hand the broadcast
   * intent tx to the swaps API (`POST /swaps/submit-tx`); the backend relays + post-executes
   * server-side. Polls `getSubmitTxStatus` until `solved`, then reconstructs the same
   * {@link SwapResponse} the client-side path returns (`result.dstIntentTxHash` → delivery info,
   * `result.intent_hash` → solver response).
   *
   * Never throws — returns `{ ok: false }` on any non-success (submit `!ok`, terminal `failed` /
   * abandoned, or poll timeout) so `swap()` falls back to {@link fallbackSwapSteps}.
   *
   * Falling back is safe: re-relaying / re-posting an already-processed swap is idempotent — the
   * relay dedups and returns the existing `executed` packet, and the solver re-affirms the intent
   * (no double-fill). Verified live by `e2e-tests/e2e-relay.test.ts`. It is also load-bearing rather
   * than belt-and-braces: the backend keeps processing after this attempt gives up, so the fallback's
   * relay can race the backend's own.
   *
   * The attempt itself — POST, budget clamps, status poll — is {@link runBackendSubmitTx}, shared with
   * bridge. What is swap-specific and lives here: the request body, the `solved` terminal status, the
   * mapping from a terminal result to a {@link SwapResponse}, and the swap error taxonomy.
   *
   * `attempt` bounds this attempt alone — the POST and every status request draw on it, and the
   * client-side fallback holds a separate fresh `timeout`.
   */
  private async submitTx<K extends SpokeChainKey>(
    _params: SwapActionParams<K, false>,
    created: CreateIntentResult<K, false>,
    attempt: SubmitTxAttempt,
  ): Promise<Result<SwapResponse, SwapError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey };
    const { tx: spokeTxHash, intent, relayData } = created;

    try {
      const outcome = await runBackendSubmitTx({
        attempt,
        api: this.backendApi.swaps,
        body: {
          txHash: spokeTxHash,
          srcChainKey,
          walletAddress: params.srcAddress,
          intent,
          relayData: relayData.payload,
        },
        statusQuery: { txHash: spokeTxHash, srcChainKey },
        // Swaps terminal success is `solved` (solver filled) — not the bridge `executed`.
        terminalStatus: 'solved',
        onExecuted: (result): SwapResponse | undefined =>
          result?.dstIntentTxHash && result.intent_hash
            ? {
                // Backend serializes the hex intent_hash as a plain string; brand it at the boundary.
                solverExecutionResponse: { answer: 'OK', intent_hash: result.intent_hash as Hex },
                intent,
                intentDeliveryInfo: {
                  srcChainKey,
                  srcTxHash: spokeTxHash,
                  srcAddress: params.srcAddress,
                  dstChainKey: params.dstChainKey,
                  dstTxHash: result.dstIntentTxHash,
                  dstAddress: params.dstAddress,
                } satisfies IntentDeliveryInfo,
              }
            : undefined,
      });
      // Any non-success — rejected POST, terminal `failed`, spent attempt — becomes the cause swap()
      // logs before falling back to the client-side relay.
      return outcome.ok
        ? { ok: true, value: outcome.value }
        : { ok: false, error: executionFailed('swap', outcome.cause, { ...baseCtx, action: 'swap' }) };
    } catch (error) {
      return { ok: false, error: unknownFailed('swap', error, { ...baseCtx, action: 'swap' }) };
    }
  }

  /**
   * Checks whether the relevant spender contract is already approved to spend the input token amount.
   *
   * - EVM hub (Sonic): checks ERC-20 allowance against the intents contract.
   * - EVM spoke chains: checks ERC-20 allowance against the spoke's asset manager.
   * - Stellar: checks trustline balance sufficiency.
   * - All other chains (Solana, NEAR, etc.): returns `true` — no on-chain allowance concept.
   *
   * Call this before `createIntent` or `swap` to decide whether an `approve` call is needed.
   *
   * @param _params - Swap action params; only `params.srcChainKey`, `params.inputToken`,
   *   `params.inputAmount`, and `params.srcAddress` are used.
   * @returns A `Result` wrapping `true` if the allowance is sufficient, `false` if approval is required.
   */
  public async isAllowanceValid<K extends SpokeChainKey>(
    _params: SwapActionParams<K, boolean>,
  ): Promise<Result<boolean>> {
    try {
      const { params } = _params;
      const srcChainKey = params.srcChainKey;

      if (isHubChainKeyType(srcChainKey)) {
        return await this.spoke.isAllowanceValid({
          srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress,
          spender: this.solver.intentsContract,
        } satisfies SpokeIsAllowanceValidParamsHub);
      }

      if (isEvmSpokeOnlyChainKeyType(srcChainKey)) {
        return await this.spoke.isAllowanceValid({
          srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress,
          spender: this.config.getChainConfig(srcChainKey).addresses.assetManager,
        } satisfies SpokeIsAllowanceValidParamsEvmSpoke);
      }

      if (isStellarChainKeyType(srcChainKey)) {
        return await this.spoke.isAllowanceValid({
          srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress,
        } satisfies SpokeIsAllowanceValidParamsStellar);
      }

      return { ok: true, value: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Approves the relevant spender contract to transfer the input token on behalf of the user.
   *
   * - EVM hub (Sonic): approves the intents contract.
   * - EVM spoke chains: approves the spoke's asset manager contract.
   * - Stellar: approves the trustline (adds/increases it).
   * - Other chain types: returns an error — approval is not supported.
   *
   * When `raw: true`, returns unsigned transaction data instead of broadcasting. That is always a
   * single transaction, which cannot express the two-step approval a TetherToken-lineage token
   * needs when a stale allowance already exists — use {@link SwapService.buildApproveTxs} for the
   * whole plan.
   * When `raw: false`, a matching wallet provider for `K` must be supplied and the transaction
   * is signed and broadcast immediately. Such an approval can take **two** transactions, so the
   * user may sign twice; the returned hash is the last one's.
   *
   * @param _params - Swap action params including the source chain key, input token, amount, and wallet provider.
   * @returns A `Result` wrapping the chain-specific transaction return type (`TxReturnType<K, Raw>`).
   */
  public async approve<K extends SpokeChainKey, Raw extends boolean>(
    _params: SwapActionParams<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>>> {
    const { params } = _params;
    const wrapApproveFailure = (cause: unknown) => approveFailed('swap', cause);

    try {
      if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        invariant(
          isOptionalEvmWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Evm wallet provider.',
        );
        const spender = isHubChainKeyType(params.srcChainKey)
          ? this.solver.intentsContract
          : this.config.getChainConfig(params.srcChainKey).addresses.assetManager;
        const coreParams = {
          srcChainKey: params.srcChainKey,
          owner: params.srcAddress as GetAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          token: params.inputToken as GetTokenAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          amount: params.inputAmount,
          spender,
        } as const;

        const result = await this.spoke.approve<HubChainKey | EvmSpokeOnlyChainKey, Raw>({
          ...coreParams,
          raw: _params.raw,
          walletProvider: _params.walletProvider,
        });

        if (!result.ok) {
          return { ok: false, error: wrapApproveFailure(result.error) };
        }

        return {
          ok: true,
          value: result.value satisfies TxReturnType<EvmSpokeOnlyChainKey, Raw> as TxReturnType<K, Raw>,
        };
      }

      if (isStellarChainKeyType(params.srcChainKey)) {
        invariant(
          isOptionalStellarWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Stellar wallet provider.',
        );
        const coreParams = {
          srcChainKey: params.srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress as GetAddressType<StellarChainKey>,
        } as const;

        const result = await this.spoke.approve<StellarChainKey, boolean>(
          _params.raw
            ? {
                ...coreParams,
                raw: true,
              }
            : {
                ...coreParams,
                raw: false,
                walletProvider: _params.walletProvider,
              },
        );

        if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

        return {
          ok: true,
          value: result.value satisfies TxReturnType<StellarChainKey, boolean> as TxReturnType<K, Raw>,
        };
      }

      return {
        ok: false,
        error: new Error('Approve only supported for hub (Sonic), EVM spokes, and Stellar'),
      };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * The unsigned approval transactions for the swap's source token, in the order they must be
   * broadcast.
   *
   * Two transactions when the source token needs its stale allowance cleared first, one otherwise.
   * {@link SwapService.approve} is unchanged and still returns a single transaction; this is the
   * entry point for unsigned callers that need to handle the two-step case. When `resetTx` is
   * present, broadcast it and wait for it to be mined first — `approveTx` is not valid until the
   * reset has landed.
   */
  public async buildApproveTxs<K extends SpokeChainKey>(
    _params: SwapActionParams<K, true>,
  ): Promise<Result<ApprovalTxs<K>>> {
    const { params } = _params;
    const wrapApproveFailure = (cause: unknown) => approveFailed('swap', cause);

    try {
      if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        const spender = isHubChainKeyType(params.srcChainKey)
          ? this.solver.intentsContract
          : this.config.getChainConfig(params.srcChainKey).addresses.assetManager;

        const result = await this.spoke.buildApproveTxs<HubChainKey | EvmSpokeOnlyChainKey>({
          srcChainKey: params.srcChainKey,
          owner: params.srcAddress as GetAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          token: params.inputToken as GetTokenAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          amount: params.inputAmount,
          spender,
          raw: true,
        });

        if (!result.ok) {
          return { ok: false, error: wrapApproveFailure(result.error) };
        }

        return {
          ok: true,
          value: result.value satisfies ApprovalTxs<HubChainKey | EvmSpokeOnlyChainKey> as ApprovalTxs<K>,
        };
      }

      if (isStellarChainKeyType(params.srcChainKey)) {
        const result = await this.spoke.buildApproveTxs<StellarChainKey>({
          srcChainKey: params.srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress as GetAddressType<StellarChainKey>,
          raw: true,
        });

        if (!result.ok) {
          return { ok: false, error: wrapApproveFailure(result.error) };
        }

        return {
          ok: true,
          value: result.value satisfies ApprovalTxs<StellarChainKey> as ApprovalTxs<K>,
        };
      }

      return {
        ok: false,
        error: new Error('Approve only supported for hub (Sonic), EVM spokes, and Stellar'),
      };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Creates a swap intent on the user's source spoke chain without submitting it to the solver.
   *
   * Use this when you need the raw transaction data or want to control the relay step yourself.
   * For a full end-to-end swap (create → relay → notify solver), use `swap()` instead.
   *
   * Strongly typed: `K` narrows `walletProvider` to the correct chain-specific provider interface,
   * and `Raw` controls whether the transaction is broadcast or returned unsigned:
   * - `raw: true` — returns unsigned transaction data; `walletProvider` must be absent.
   * - `raw: false` — broadcasts the transaction; `walletProvider` is required and must match `K`.
   *
   * Validates tokens and chain keys against the active `ConfigService` before constructing the
   * intent. Bitcoin source chains require an additional Bound Exchange access token step.
   *
   * @param _params - Intent parameters, source chain key, wallet provider (when `raw: false`),
   *   and optional `skipSimulation` flag.
   * @returns A `Result<CreateIntentResult<K, Raw>, SwapCreateIntentError>`. On success contains:
   *   - `tx` — chain-specific tx hash (executed) or raw tx data (raw mode).
   *   - `intent` — the fully constructed `Intent` object augmented with `feeAmount`.
   *   - `relayData` — `{ address, payload }` needed to submit the intent to the relayer.
   *
   *   On failure `result.error` is a {@link SodaxError} with one of:
   *   - `VALIDATION_FAILED` — invariant precondition failed (unsupported tokens,
   *     invalid chain key, Bitcoin dust output below 546 sats, invalid wallet provider).
   *     The original prose is on `result.error.message`; phase is `'validate'`.
   *   - `INTENT_CREATION_FAILED` — spoke-side intent creation/deposit failed.
   *   - `UNKNOWN` — defensive fallback.
   */
  public async createIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: SwapActionParams<K, Raw>,
  ): Promise<Result<CreateIntentResult<K, Raw>, SwapCreateIntentError>> {
    const { params, skipSimulation, extras } = _params;
    // Per-action `extras.partnerFee` is primary; `this.partnerFee` (the effective swap fee,
    // `swaps.partnerFee ?? fee`, read live off config) is the fallback default. undefined = no fee.
    const partnerFee = extras?.partnerFee ?? this.partnerFee;
    const baseCtx = { srcChainKey: params.srcChainKey, dstChainKey: params.dstChainKey };

    try {
      swapInvariant(
        isUndefinedOrValidWalletProviderForChainKey(params.srcChainKey, _params.walletProvider),
        `Invalid wallet provider for chain key: ${params.srcChainKey}`,
        baseCtx,
      );
      swapInvariant(
        this.config.isValidOriginalAssetAddress(params.srcChainKey, params.inputToken),
        `Unsupported spoke chain token (srcChainKey): ${params.srcChainKey}, params.inputToken): ${params.inputToken}`,
        { ...baseCtx, field: 'inputToken' },
      );
      swapInvariant(
        this.config.isValidOriginalAssetAddress(params.dstChainKey, params.outputToken),
        `Unsupported spoke chain token (params.dstChain): ${params.dstChainKey}, params.outputToken): ${params.outputToken}`,
        { ...baseCtx, field: 'outputToken' },
      );
      swapInvariant(
        this.config.isValidSpokeChainKey(params.srcChainKey),
        `Invalid spoke chain (srcChainKey): ${params.srcChainKey}`,
        { ...baseCtx, field: 'srcChainKey' },
      );
      swapInvariant(
        this.config.isValidSpokeChainKey(params.dstChainKey),
        `Invalid spoke chain (params.dstChain): ${params.dstChainKey}`,
        { ...baseCtx, field: 'dstChainKey' },
      );
      // Native BTC on the Bitcoin chain is denominated in satoshis and must clear the 546-sat dust limit —
      // the BTC deposit on a Bitcoin source and the BTC delivery to a Bitcoin destination alike. `inputToken`
      // / `outputToken` are original asset addresses (native BTC is '0:0'), so resolve them to token
      // descriptors and match on symbol rather than comparing the address against the 'BTC' string.
      const inputTokenInfo = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, params.inputToken);
      if (isNativeBitcoinTransfer(this.config, params.srcChainKey, inputTokenInfo)) {
        swapInvariant(
          params.inputAmount >= BITCOIN_DUST_SATS,
          `Invalid inputAmount (${params.inputAmount}): below the Bitcoin dust limit of ${BITCOIN_DUST_SATS} sats`,
          { ...baseCtx, field: 'inputAmount' },
        );
      }
      const outputTokenInfo = this.config.getSpokeTokenFromOriginalAssetAddress(params.dstChainKey, params.outputToken);
      if (isNativeBitcoinTransfer(this.config, params.dstChainKey, outputTokenInfo)) {
        swapInvariant(
          params.minOutputAmount >= BITCOIN_DUST_SATS,
          `Invalid minOutputAmount (${params.minOutputAmount}): below the Bitcoin dust limit of ${BITCOIN_DUST_SATS} sats`,
          { ...baseCtx, field: 'minOutputAmount' },
        );
      }
      if (isStacksChainKeyType(params.srcChainKey) && _params.raw === true) {
        swapInvariant(
          extras?.srcPublicKey !== undefined,
          'srcPublicKey is required for Stacks createIntent (raw) — the source tx is built unsigned and needs the signer public key',
          { ...baseCtx, field: 'srcPublicKey' },
        );
      }

      const personalAddress = params.srcAddress;

      // Bitcoin TRADING mode: derive the hub wallet from the trading address (raw + non-raw), since
      // deposits originate from the trading wallet, not the personal one.
      let walletAddress: string = personalAddress;
      if (isBitcoinChainKeyType(params.srcChainKey)) {
        if (_params.raw === false) {
          // Non-raw needs a provider to sign; only TRADING mode needs Bound auth (USER is self-custody).
          swapInvariant(
            isBitcoinWalletProviderType(_params.walletProvider),
            `Invalid wallet provider for chain key: ${params.srcChainKey}`,
            baseCtx,
          );
          if (this.spoke.bitcoin.walletMode === 'TRADING') {
            await this.spoke.bitcoin.radfi.ensureRadfiAccessToken(_params.walletProvider);
          }
        }
        walletAddress = await this.spoke.bitcoin.getEffectiveWalletAddress(personalAddress);
      }

      // derive users hub wallet address
      const creatorHubWalletAddress = await this.hubProvider.getUserHubWalletAddress(walletAddress, params.srcChainKey);

      if (isHubChainKeyType(params.srcChainKey) && isSonicChainKeyType(params.srcChainKey)) {
        const coreSonicParams = {
          createIntentParams: params,
          creatorHubWalletAddress,
          solverConfig: this.solver,
          fee: partnerFee,
          hubProvider: this.hubProvider,
        } as const;

        // on hub chain create intent directly
        const [txResult, intent, feeAmount, data] = await SonicSpokeService.createSwapIntent(
          _params.raw
            ? { ...coreSonicParams, raw: true }
            : {
                ...coreSonicParams,
                raw: false,
                walletProvider: _params.walletProvider as GetWalletProviderType<SonicChainKey>,
              },
        );

        return {
          ok: true,
          value: {
            tx: txResult satisfies TxReturnType<SonicChainKey, boolean> as TxReturnType<K, Raw>,
            intent: { ...intent, feeAmount } as Intent & FeeAmount,
            relayData: { address: intent.creator, payload: data },
          },
        };
      }

      // construct the intent data
      const [data, intent, feeAmount] = EvmSolverService.constructCreateIntentData(
        {
          ...params,
          srcAddress: walletAddress,
        },
        creatorHubWalletAddress,
        this.config,
        partnerFee,
      );

      const coreDepositParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: walletAddress as GetAddressType<K>,
        srcPublicKey: extras?.srcPublicKey,
        // Bitcoin Bound token; BitcoinSpokeService.deposit falls back to the RadfiProvider instance token when undefined.
        accessToken: extras?.bound?.accessToken,
        to: creatorHubWalletAddress,
        token: params.inputToken as GetTokenAddressType<K>,
        amount: params.inputAmount,
        data: data,
        skipSimulation,
      } as const;

      const txResult = await this.spoke.deposit(
        _params.raw
          ? {
              ...coreDepositParams,
              raw: true,
            }
          : {
              ...coreDepositParams,
              raw: false,
              walletProvider: _params.walletProvider as GetWalletProviderType<K>,
            },
      );

      if (!txResult.ok) {
        if (isSwapCreateIntentError(txResult.error)) {
          return { ok: false, error: txResult.error };
        }
        return {
          ok: false,
          error: intentCreationFailed('swap', txResult.error, baseCtx),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
          intent: { ...intent, feeAmount } as Intent & FeeAmount,
          relayData: { address: intent.creator, payload: data },
        },
      };
    } catch (error) {
      // swapInvariant() throws SodaxError<'VALIDATION_FAILED'> directly, so the guard
      // catches validation failures by code membership. Anything else (a hubProvider
      // rejection, deposit throw, etc.) gets wrapped as INTENT_CREATION_FAILED with
      // the original on cause.
      if (isSwapCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('swap', error, baseCtx),
      };
    }
  }

  /**
   * Submits a full end-to-end limit order (create intent → relay → notify solver).
   *
   * A limit order is a swap intent with `deadline = 0n`, meaning it has no expiry and stays
   * active until the solver fills it at `minOutputAmount` or the user cancels it via
   * `cancelLimitOrder`. The `deadline` field is forced to `0n` regardless of any value
   * in `_params.params`.
   *
   * This is the limit-order equivalent of `swap()`.
   *
   * @param _params - Limit order action params (same shape as `swap()` but uses `CreateLimitOrderParams`).
   * @returns A `Result` containing `SwapResponse` — same structure as `swap()`.
   */
  public async createLimitOrder<K extends SpokeChainKey>(
    _params: LimitOrderActionParams<K, false>,
  ): Promise<Result<SwapResponse, SwapError>> {
    const { timeout, skipSimulation } = _params;
    // Force deadline to 0n (no deadline) for limit orders. K is preserved on the resulting
    // CreateIntentParams<K> so swap() infers the same chain narrowing.
    const params: CreateIntentParams<K> = {
      ..._params.params,
      deadline: 0n,
    } as CreateIntentParams<K>;

    return this.swap<K>({
      ..._params,
      params,
      timeout,
      skipSimulation,
    });
  }

  /**
   * Creates a limit order intent on the source spoke chain without submitting it to the solver.
   *
   * The limit-order equivalent of `createIntent()`: forces `deadline = 0n` (no expiry) and
   * delegates to `createIntent`. Does not relay or notify the solver — use `createLimitOrder()`
   * for the full lifecycle.
   *
   * Supports both raw mode (`raw: true`) and executed mode (`raw: false`).
   *
   * @param _params - Limit order action params including intent parameters, chain key, and optional raw flag.
   * @returns A `Result` containing `CreateIntentResult<K, Raw>` — same structure as `createIntent()`.
   */
  public async createLimitOrderIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: LimitOrderActionParams<K, Raw>,
  ): Promise<Result<CreateIntentResult<K, Raw>, SwapCreateIntentError>> {
    // Force deadline to 0n for limit orders. srcChain is preserved on params so K narrowing
    // flows through to createIntent unchanged.
    const limitOrderParams: CreateIntentParams<K> = {
      ..._params.params,
      deadline: 0n,
    } as const as CreateIntentParams<K>;

    return this.createIntent({
      ..._params,
      params: limitOrderParams,
    } as SwapActionParams<K, Raw>);
  }

  /**
   * Cancels an active limit order and waits for the cancellation to be confirmed on the hub chain.
   *
   * Convenience alias for `cancelIntent` — semantically equivalent, exposed under a
   * domain-specific name for callers who think in terms of limit orders rather than intents.
   *
   * @param params - Cancel params including `srcChainKey`, the `intent` to cancel, wallet provider,
   *   and an optional `timeout` in milliseconds.
   * @returns A `Result` containing `TxHashPair`:
   *   - `srcChainTxHash` — cancel tx hash on the source spoke chain.
   *   - `dstChainTxHash` — corresponding hub-chain (Sonic) tx hash after relay.
   */
  public async cancelLimitOrder<K extends SpokeChainKey>(
    params: CancelIntentActionParams<K, false>,
  ): Promise<Result<TxHashPair>> {
    return this.cancelIntent(params);
  }

  /**
   * Builds and optionally broadcasts the cancel-intent transaction on the source spoke chain.
   *
   * Does not relay or wait for hub confirmation — call `cancelIntent` for the full lifecycle.
   * Use this directly only when you need raw transaction data or manual relay control.
   *
   * Because `Intent.srcChain` is an `IntentRelayChainId` (bigint) whose literal type cannot
   * narrow to a specific `SpokeChainKey`, the caller must pass `srcChainKey: K` explicitly.
   * At runtime the method asserts `getIntentRelayChainId(srcChainKey) === intent.srcChain` to
   * catch mismatches. `K` then narrows `walletProvider` the same way `createIntent` does.
   *
   * @param _params - Cancel params including `srcChainKey`, the `intent` to cancel, raw flag,
   *   and wallet provider (required when `raw: false`).
   * @returns A `Result` wrapping the chain-specific transaction return type (`TxReturnType<K, Raw>`).
   */
  public async createCancelIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: CancelIntentActionParams<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>>> {
    const { params } = _params;

    try {
      invariant(
        this.config.isValidIntentRelayChainId(params.intent.srcChain),
        `Invalid intent.srcChain: ${params.intent.srcChain}`,
      );
      invariant(
        this.config.isValidIntentRelayChainId(params.intent.dstChain),
        `Invalid intent.dstChain: ${params.intent.dstChain}`,
      );
      invariant(
        getIntentRelayChainId(params.srcChainKey) === params.intent.srcChain,
        `srcChainKey (${params.srcChainKey}) does not match intent.srcChain (${params.intent.srcChain}). Expected relay chain id ${getIntentRelayChainId(params.srcChainKey)}.`,
      );

      const intentsContract = this.solver.intentsContract;

      const coreParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: reverseEncodeAddress(params.srcChainKey, params.intent.srcAddress) as GetAddressType<K>,
        dstChainKey: HUB_CHAIN_KEY,
        dstAddress: params.intent.creator,
        payload: encodeContractCalls([EvmSolverService.encodeCancelIntent(params.intent, intentsContract)]),
        skipSimulation: params.skipSimulation,
      } as const;

      const sendMessageParams = _params.raw
        ? ({
            ...coreParams,
            raw: true,
          } satisfies SendMessageParams<K, true>)
        : ({
            ...coreParams,
            raw: false,
            walletProvider: _params.walletProvider,
          } satisfies SendMessageParams<K, false>);

      const txResult = await this.spoke.sendMessage(sendMessageParams);

      if (!txResult.ok) return { ok: false, error: intentCreationFailed('swap', txResult.error) };

      return {
        ok: true,
        value: txResult.value satisfies TxReturnType<K, boolean> as TxReturnType<K, Raw>,
      };
    } catch (error) {
      if (isSwapCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('swap', error) };
    }
  }

  /**
   * Cancels an intent on the source spoke chain and waits for the cancellation to land on the hub.
   *
   * Full cancellation lifecycle:
   * 1. Calls `createCancelIntent` to broadcast the cancel transaction on the spoke chain.
   * 2. Verifies the spoke transaction.
   * 3. For non-hub source chains: submits to the relayer and polls until the cancel packet
   *    is delivered to the hub. For hub source chains, the spoke tx hash is reused directly.
   *
   * @param _params - Cancel params including `srcChainKey`, the `intent`, wallet provider, and
   *   an optional `timeout` in milliseconds.
   * @returns A `Result` containing `TxHashPair`:
   *   - `srcChainTxHash` — cancel tx hash on the source spoke chain.
   *   - `dstChainTxHash` — hub-chain (Sonic) tx hash confirming the cancellation.
   */
  public async cancelIntent<K extends SpokeChainKey>(
    _params: CancelIntentActionParams<K, false>,
  ): Promise<Result<TxHashPair>> {
    const { params } = _params;
    try {
      const cancelResult = await this.createCancelIntent<K, false>(_params);
      if (!cancelResult.ok) return cancelResult;

      const cancelTxHash = cancelResult.value;

      const verifyTxHashResult = await this.spoke.verifyTxHash({
        txHash: cancelTxHash,
        chainKey: params.srcChainKey,
      });
      if (!verifyTxHashResult.ok) return verifyTxHashResult;

      let dstIntentTxHash: string;

      if (!isHubChainKey(params.srcChainKey)) {
        const intentRelayChainId = params.intent.srcChain.toString();
        const submitPayload: IntentRelayRequest<'submit'> = {
          action: 'submit',
          params: {
            chain_id: intentRelayChainId,
            tx_hash: cancelTxHash,
          },
        };

        const submitResult = await this.submitIntent(submitPayload);
        if (!submitResult.ok) return submitResult;

        const packet = await waitUntilIntentExecuted({
          intentRelayChainId,
          srcTxHash: cancelTxHash,
          timeout: _params.timeout,
          apiUrl: this.relayerApiEndpoint,
        });
        if (!packet.ok) return packet;
        dstIntentTxHash = packet.value.dst_tx_hash;
      } else {
        dstIntentTxHash = cancelTxHash;
      }

      return { ok: true, value: { srcChainTxHash: cancelTxHash, dstChainTxHash: dstIntentTxHash } };
    } catch (error) {
      if (isSwapError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('swap', error, { action: 'cancelIntent' }) };
    }
  }

  /**
   * Returns the relay extra data (`address` + `payload`) required to submit an intent to the relayer API.
   *
   * Currently only required when the source chain is Solana or Bitcoin, where extra call data must be
   * bundled with the relay submission. On other chains this is derived automatically inside
   * `createIntent`.
   *
   * Accepts either a hub-chain tx hash (will fetch the intent on-chain first) or a
   * pre-fetched `Intent` object directly.
   *
   * @param params - Either `{ txHash: Hash }` to look up the intent, or `{ intent: Intent }` to use directly.
   * @returns A `Result` containing `RelayExtraData`: `{ address: Hex; payload: Hex }`.
   */
  public async getIntentSubmitTxExtraData(params: GetIntentSubmitTxExtraDataParams): Promise<Result<RelayExtraData>> {
    try {
      let intent: Intent;
      if ('txHash' in params) {
        const intentResult = await this.getIntent(params.txHash);
        if (!intentResult.ok) return intentResult;
        intent = intentResult.value;
      } else {
        intent = params.intent;
      }

      const txData = EvmSolverService.encodeCreateIntent(intent, this.solver.intentsContract);

      return {
        ok: true,
        value: {
          address: intent.creator,
          payload: txData.data,
        },
      };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Re-derives the byte-identical relay extra data (`{ address, payload }`) for a swap intent from a
   * fully-populated `Intent` alone — no on-chain call, no original `createIntent` return value needed.
   *
   * The `payload` matches exactly what `createIntent` relayed when the intent was first created:
   * - Sonic-hub source — raw `createIntent(intent)` calldata.
   * - Any spoke source — the `[approve, createIntent]` multicall (uniform across all spokes).
   *
   * Byte-identity is possible because the only originally-random field, `intentId`, is already
   * carried on the `Intent`; everything else in the payload is a pure function of the intent and
   * the configured intents contract. Use this to rebuild relay submission data for a manual relay
   * step when the runtime `relayData` from `createIntent` is no longer available.
   *
   * @param intent - A fully-populated intent (e.g. from `getIntent(txHash)` or the `intent` field
   *   returned by `createIntent`).
   * @returns A `Result` containing `RelayExtraData`: `{ address: Hex; payload: Hex }`.
   */
  public reconstructRelayData(intent: Intent): Result<RelayExtraData> {
    try {
      invariant(this.config.isValidIntentRelayChainId(intent.srcChain), `Invalid intent.srcChain: ${intent.srcChain}`);
      invariant(this.config.isValidIntentRelayChainId(intent.dstChain), `Invalid intent.dstChain: ${intent.dstChain}`);

      const isHubSource = intent.srcChain === getIntentRelayChainId(HUB_CHAIN_KEY);
      const payload = EvmSolverService.reconstructCreateIntentData(intent, this.solver.intentsContract, isHubSource);

      return { ok: true, value: { address: intent.creator, payload } };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Fetches a previously created `Intent` from the hub chain by its transaction hash.
   *
   * Parses the `IntentCreated` event log from the transaction receipt.
   *
   * @param txHash - Transaction hash of the hub-chain (Sonic) intent creation transaction.
   * @returns A `Result` containing the `Intent` struct, or an error if the tx has no matching event.
   */
  public async getIntent(txHash: Hash): Promise<Result<Intent>> {
    try {
      const value = await EvmSolverService.getIntent(txHash, this.config, this.hubProvider.publicClient);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Fetches the fill state of an intent from the hub chain by the solver's fill transaction hash.
   *
   * Parses the `IntentFilled` event log from the transaction receipt. Useful for confirming
   * partial fills or verifying the final received output amount.
   *
   * @param txHash - Transaction hash of the hub-chain (Sonic) intent fill transaction.
   * @returns A `Result` containing `IntentState`: `{ exists, remainingInput, receivedOutput, pendingPayment }`.
   */
  public async getFilledIntent(txHash: Hash): Promise<Result<IntentState>> {
    try {
      const value = await EvmSolverService.getFilledIntent(txHash, this.solver, this.hubProvider.publicClient);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Polls the relayer API until the solver's fill transaction has been delivered to the
   * destination spoke chain, then returns the relay packet data.
   *
   * Use this after `getStatus` returns `SolverIntentStatusCode.SOLVED (3)` to obtain the
   * destination-chain transaction hash from `packet.dst_tx_hash`.
   *
   * A single solver fill tx emits multiple relay packets sharing the same `src_tx_hash`. The
   * user-facing `IntentFilled` delivery is the packet whose payload targets the hub intents
   * contract; `selectSolvedIntentPacket` disambiguates so the returned `dst_tx_hash` is the
   * destination delivery tx rather than an internal hop.
   *
   * @param chainId - The destination spoke chain key (where output tokens are delivered).
   * @param fillTxHash - The solver's fill transaction hash, obtained from `getStatus.fill_tx_hash`.
   * @param timeout - Poll timeout in milliseconds. Defaults to `DEFAULT_RELAY_TX_TIMEOUT` (120 s).
   * @returns A `Result` containing `PacketData` with relay details including `dst_tx_hash`,
   *   or an error tagged `'RELAY_TIMEOUT'` if the packet does not arrive within `timeout`.
   */
  public async getSolvedIntentPacket({
    chainId,
    fillTxHash,
    timeout = DEFAULT_RELAY_TX_TIMEOUT,
  }: {
    chainId: SpokeChainKey;
    fillTxHash: string;
    timeout?: number;
  }): Promise<Result<PacketData>> {
    return waitUntilIntentExecuted({
      intentRelayChainId: getIntentRelayChainId(chainId).toString(),
      srcTxHash: fillTxHash,
      timeout,
      apiUrl: this.relayerApiEndpoint,
      selectPacket: packets => selectSolvedIntentPacket(packets, this.solver.intentsContract),
    });
  }

  /**
   * Computes the keccak256 hash of an intent struct, which serves as its unique ID on the hub chain.
   *
   * @param intent - The intent to hash.
   * @returns The `0x`-prefixed keccak256 digest of the ABI-encoded intent.
   */
  public getIntentHash(intent: Intent): Hex {
    return EvmSolverService.getIntentHash(intent);
  }

  /**
   * Computes an absolute deadline timestamp for a swap intent.
   *
   * Fetches the latest hub-chain (Sonic) block timestamp and adds `deadline` seconds to it.
   * Pass the result as `CreateIntentParams.deadline`. Use `0n` in `createIntent` directly for
   * no expiry (limit orders).
   *
   * @param deadline - Offset in seconds from the current hub-chain block time.
   *   Defaults to `DEFAULT_DEADLINE_OFFSET` (5 minutes). Must be greater than `0n`.
   * @returns A `Result` containing the absolute deadline as a Unix timestamp (bigint, seconds).
   * @throws Invariant error (forwarded as `Result.error`) if `deadline` is `0n` or negative.
   */
  public async getSwapDeadline(deadline: bigint = DEFAULT_DEADLINE_OFFSET): Promise<Result<bigint>> {
    try {
      invariant(deadline > 0n, 'Deadline must be greater than 0');

      const block = await this.hubProvider.publicClient.getBlock({
        includeTransactions: false,
        blockTag: 'latest',
      });
      return { ok: true, value: block.timestamp + deadline };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Returns the list of tokens supported for swapping on a specific spoke chain.
   *
   * @param chainId - The spoke chain key to query.
   * @returns A readonly array of `XToken` objects available for swapping on that chain.
   */
  public getSupportedSwapTokensByChainId(chainId: SpokeChainKey): readonly XToken[] {
    return this.config.getSupportedSwapTokensByChainId(chainId);
  }

  /**
   * Returns all supported swap tokens across every spoke chain.
   *
   * @returns A map from each `SpokeChainKey` to its readonly array of supported `XToken` objects.
   */
  public getSupportedSwapTokens(): Record<SpokeChainKey, readonly XToken[]> {
    return this.config.getSupportedSwapTokens();
  }
}
