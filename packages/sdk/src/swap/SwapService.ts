import invariant from 'tiny-invariant';
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
} from '../shared/index.js';
import { SolverApiService } from './SolverApiService.js';
import { EvmSolverService } from './EvmSolverService.js';
export type {
  CreateIntentParams,
  CreateLimitOrderParams,
  Intent,
  FeeData,
  IntentData,
  IntentState,
} from '../shared/types/intent-types.js';
export { IntentDataType } from '../shared/types/intent-types.js';
import type { CreateIntentParams, CreateLimitOrderParams, Intent, IntentState } from '../shared/types/intent-types.js';
import {
  type SpokeChainKey,
  type Hex,
  type Hash,
  type HttpUrl,
  getIntentRelayChainId,
  isBitcoinChainKey,
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
  spokeChainConfig,
  type SpokeExecActionParams,
  type SonicChainKey,
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
  CreateIntentParams<K>
>;

export type LimitOrderActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  CreateLimitOrderParams<K>
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

export type SwapServiceConstructorParams = {
  config: ConfigService;
  spoke: SpokeService;
  hubProvider: HubProvider;
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
  readonly partnerFee: PartnerFee | undefined;
  readonly relayerApiEndpoint: HttpUrl;

  public constructor({ config, hubProvider, spoke }: SwapServiceConstructorParams) {
    this.solver = config.solver;
    this.partnerFee = config.swaps.partnerFee;
    this.relayerApiEndpoint = config.relay.relayerApiEndpoint;
    this.config = config;
    this.hubProvider = hubProvider;
    this.spoke = spoke;
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
   * Adjusts `payload.amount` by the configured partner fee before forwarding to the solver,
   * so the returned `quoted_amount` reflects the net output the user actually receives.
   *
   * @param payload - Source/destination tokens, chain IDs, input amount, and quote type.
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
  public async getQuote(
    payload: SolverIntentQuoteRequest,
  ): Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse>> {
    payload = {
      ...payload,
      amount: adjustAmountByFee(payload.amount, this.partnerFee, payload.quote_type),
    } satisfies SolverIntentQuoteRequest;
    return SolverApiService.getQuote(payload, this.solver, this.config);
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
    return SolverApiService.getStatus(request, this.solver);
  }

  /**
   * Notifies the solver API that an intent has been registered on the hub chain, triggering
   * the solver to begin filling it.
   *
   * Called automatically by `swap()` after the cross-chain relay packet lands on the hub. You
   * only need to call this manually when orchestrating the swap steps yourself.
   *
   * @param request - Object containing `intent_tx_hash` — the hub-chain tx where the intent was created.
   * @returns A `Result` containing `{ answer: 'OK', intent_hash: Hex }` on success.
   */
  public async postExecution(
    request: SolverExecutionRequest,
  ): Promise<Result<SolverExecutionResponse, SolverErrorResponse>> {
    return SolverApiService.postExecution(request, this.solver);
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
   * Orchestrates the complete swap lifecycle:
   * 1. Calls `createIntent` to submit the intent transaction on the source spoke chain.
   * 2. Verifies the spoke transaction landed on-chain.
   * 3. For non-hub source chains: submits the spoke tx to the relayer and waits for the
   *    relay packet to land on the hub (Sonic). Skipped when `srcChainKey` is the hub.
   * 4. Calls `postExecution` to notify the solver, triggering it to fill the intent.
   *
   * On failure, `result.error` is an `Error` whose message is a phase tag:
   * `'POST_EXECUTION_FAILED'` or `'RELAY_TIMEOUT'`; the underlying cause is on `.cause`.
   *
   * @param _params - Swap action params including intent parameters, wallet provider, and optional timeout.
   * @returns A `Result` containing `SwapResponse` on success:
   *   - `solverExecutionResponse` — solver acknowledgement (`{ answer: 'OK', intent_hash }`).
   *   - `intent` — the on-chain intent object that was created.
   *   - `intentDeliveryInfo` — source/destination chain keys, tx hashes, and user addresses.
   */
  public async swap<K extends SpokeChainKey>(_params: SwapActionParams<K, false>): Promise<Result<SwapResponse>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    try {
      const timeout = _params.timeout;
      const createIntentResult = await this.createIntent(_params);
      if (!createIntentResult.ok) return createIntentResult;

      const { tx: spokeTxHash, intent, relayData } = createIntentResult.value;

      const verifyTxHashResult = await this.spoke.verifyTxHash({
        txHash: spokeTxHash,
        chainKey: srcChainKey,
      });
      if (!verifyTxHashResult.ok) return verifyTxHashResult;

      let dstIntentTxHash: string;
      if (isHubChainKeyType(srcChainKey)) {
        dstIntentTxHash = spokeTxHash;
      } else {
        const packet = await relayTxAndWaitPacket({
          srcTxHash: spokeTxHash,
          data: relayData,
          chainKey: srcChainKey,
          relayerApiEndpoint: this.relayerApiEndpoint,
          timeout,
        });
        if (!packet.ok) return packet;
        dstIntentTxHash = packet.value.dst_tx_hash;
      }

      const result = await this.postExecution({
        intent_tx_hash: dstIntentTxHash as `0x${string}`,
      });
      if (!result.ok) {
        return { ok: false, error: new Error('POST_EXECUTION_FAILED', { cause: result.error }) };
      }

      return {
        ok: true,
        value: {
          solverExecutionResponse: result.value,
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
    } catch (error) {
      return { ok: false, error };
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
          spender: spokeChainConfig[srcChainKey].addresses.assetManager,
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
   * When `raw: true`, returns unsigned transaction data instead of broadcasting.
   * When `raw: false`, a matching wallet provider for `K` must be supplied and the transaction
   * is signed and broadcast immediately.
   *
   * @param _params - Swap action params including the source chain key, input token, amount, and wallet provider.
   * @returns A `Result` wrapping the chain-specific transaction return type (`TxReturnType<K, Raw>`).
   */
  public async approve<K extends SpokeChainKey, Raw extends boolean>(
    _params: SwapActionParams<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>>> {
    const { params } = _params;

    try {
      if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        invariant(
          isOptionalEvmWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Evm wallet provider.',
        );
        const spender = isHubChainKeyType(params.srcChainKey)
          ? this.solver.intentsContract
          : spokeChainConfig[params.srcChainKey].addresses.assetManager;
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
          return result;
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

        if (!result.ok) return result;

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
   * intent. Bitcoin source chains require an additional RadFi access token step.
   *
   * @param _params - Intent parameters, source chain key, wallet provider (when `raw: false`),
   *   and optional `skipSimulation` flag.
   * @returns A `Result` containing `CreateIntentResult<K, Raw>`:
   *   - `tx` — chain-specific tx hash (executed) or raw tx data (raw mode).
   *   - `intent` — the fully constructed `Intent` object augmented with `feeAmount`.
   *   - `relayData` — `{ address, payload }` needed to submit the intent to the relayer.
   *
   * Invariant violations (unsupported tokens, mismatched chain keys, insufficient Bitcoin dust
   * output below 546 sats) are caught inside this method and returned as `{ ok: false, error }`,
   * not thrown from the async API boundary.
   */
  public async createIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: SwapActionParams<K, Raw>,
  ): Promise<Result<CreateIntentResult<K, Raw>>> {
    const { params, skipSimulation } = _params;

    try {
      invariant(
        isUndefinedOrValidWalletProviderForChainKey(params.srcChainKey, _params.walletProvider),
        `Invalid wallet provider for chain key: ${params.srcChainKey}`,
      );
      invariant(
        this.config.isValidOriginalAssetAddress(params.srcChainKey, params.inputToken),
        `Unsupported spoke chain token (srcChainKey): ${params.srcChainKey}, params.inputToken): ${params.inputToken}`,
      );
      invariant(
        this.config.isValidOriginalAssetAddress(params.dstChainKey, params.outputToken),
        `Unsupported spoke chain token (params.dstChain): ${params.dstChainKey}, params.outputToken): ${params.outputToken}`,
      );
      invariant(
        this.config.isValidSpokeChainKey(params.srcChainKey),
        `Invalid spoke chain (srcChainKey): ${params.srcChainKey}`,
      );
      invariant(
        this.config.isValidSpokeChainKey(params.dstChainKey),
        `Invalid spoke chain (params.dstChain): ${params.dstChainKey}`,
      );
      //if dstChain is Bitcoin and token is BTC, check minOutputToken should be higher than 546 sats
      if (isBitcoinChainKey(params.dstChainKey) && params.outputToken === 'BTC') {
        invariant(
          params.minOutputAmount >= 546n,
          `Invalid minOutputAmount (params.minOutputAmount): ${params.minOutputAmount}`,
        );
      }
      const personalAddress = params.srcAddress;

      // Bitcoin TRADING mode: use trading wallet for hub wallet derivation (see getEffectiveWalletAddress)
      // NOTE: bitcoin is only enabled in non-raw execution mode == walletProvider is required
      let walletAddress: string = personalAddress;
      if (isBitcoinChainKeyType(params.srcChainKey) && _params.raw === false) {
        invariant(
          isBitcoinWalletProviderType(_params.walletProvider),
          `Invalid wallet provider for chain key: ${params.srcChainKey}`,
        );
        walletAddress = await this.spoke.bitcoin.getEffectiveWalletAddress(personalAddress);
        await this.spoke.bitcoin.radfi.ensureRadfiAccessToken(_params.walletProvider);
      }

      // derive users hub wallet address
      const creatorHubWalletAddress = await this.hubProvider.getUserHubWalletAddress(walletAddress, params.srcChainKey);

      if (isHubChainKeyType(params.srcChainKey) && isSonicChainKeyType(params.srcChainKey)) {
        const coreSonicParams = {
          createIntentParams: params,
          creatorHubWalletAddress,
          solverConfig: this.solver,
          fee: this.config.swaps.partnerFee,
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
        this.config.swaps.partnerFee,
      );

      const coreDepositParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: walletAddress as GetAddressType<K>,
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
        return txResult;
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
      console.error('[SwapService.createIntent] FAILED', error);
      return { ok: false, error };
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
  ): Promise<Result<SwapResponse>> {
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
  ): Promise<Result<CreateIntentResult<K, Raw>>> {
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

      if (!txResult.ok) return txResult;

      return {
        ok: true,
        value: txResult.value satisfies TxReturnType<K, boolean> as TxReturnType<K, Raw>,
      };
    } catch (error) {
      return { ok: false, error };
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
      return { ok: false, error };
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
  }: { chainId: SpokeChainKey; fillTxHash: string; timeout?: number }): Promise<Result<PacketData>> {
    return waitUntilIntentExecuted({
      intentRelayChainId: getIntentRelayChainId(chainId).toString(),
      srcTxHash: fillTxHash,
      timeout,
      apiUrl: this.relayerApiEndpoint,
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
