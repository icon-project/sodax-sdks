import {
  type SpokeService,
  Erc20Service,
  type HubProvider,
  relayTxAndWaitPacket,
  EvmVaultTokenService,
  EvmAssetManagerService,
  encodeContractCalls,
  calculateFeeAmount,
  encodeAddress,
  wrappedSonicAbi,
  isHubChainKeyType,
  isStellarChainKeyType,
  type SpokeIsAllowanceValidParamsHub,
  type SpokeIsAllowanceValidParamsEvmSpoke,
  type SpokeIsAllowanceValidParamsStellar,
  isEvmSpokeOnlyChainKeyType,
  isBitcoinChainKeyType,
  isBitcoinWalletProviderType,
  isOptionalEvmWalletProviderType,
  isOptionalStellarWalletProviderType,
  type SpokeApproveParams,
} from '../shared/index.js';
import type { IntentTxResult, TxHashPair } from '../shared/types/types.js';
import {
  type SpokeChainKey,
  type XToken,
  type Hex,
  type BridgeLimit,
  type GetAddressType,
  type Result,
  type HubChainKey,
  type TxReturnType,
  type EvmContractCall,
  type PartnerFee,
  type VaultReserves,
  type StellarChainKey,
  isHubChainKey,
  type GetWalletProviderType,
  type EvmSpokeOnlyChainKey,
  type GetTokenAddressType,
  type SpokeExecActionParams,
} from '@sodax/types';
import { encodeFunctionData } from 'viem';
import type { ConfigService } from '../shared/config/ConfigService.js';
import BigNumber from 'bignumber.js';
import { lookupFailed, verifyFailed, intentCreationFailed, executionFailed, approveFailed, allowanceCheckFailed } from '../errors/wrappers.js';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import {
  type BridgeAllowanceCheckError,
  type BridgeApproveError,
  type BridgeCreateIntentError,
  type BridgeLookupError,
  type BridgeOrchestrationError,
  bridgeInvariant,
  isBridgeAllowanceCheckError,
  isBridgeApproveError,
  isBridgeCreateIntentError,
  isBridgeLookupError,
  isBridgeOrchestrationError,
} from './errors.js';

export type CreateBridgeIntentParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcAddress: string;
  srcChainKey: K;
  srcToken: string;
  amount: bigint;
  dstChainKey: SpokeChainKey;
  dstToken: string;
  recipient: string; // non-encoded recipient address
};

export type BridgeParams<ChainKey extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  ChainKey,
  Raw,
  CreateBridgeIntentParams<ChainKey>
>;

export type BridgeServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
  spoke: SpokeService;
};

/**
 * Orchestrates cross-chain token transfers within the SODAX hub-and-spoke architecture.
 *
 * Bridging works by depositing tokens into a spoke vault on the source chain, which triggers
 * a cross-chain message relayed to the Sonic hub. The hub then performs vault transformations
 * (deposit/withdraw) and forwards the tokens to the destination chain via the asset manager.
 *
 * Supports three transfer directions:
 * - Spoke → Hub (deposit into hub vault)
 * - Hub → Spoke (withdrawal from hub vault)
 * - Spoke → Spoke (deposit on source + withdraw on destination)
 *
 * The high-level `bridge()` method handles the full lifecycle. For fine-grained control,
 * `createBridgeIntent()` executes only the spoke-side deposit, leaving relay to the caller.
 */
export class BridgeService {
  public readonly hubProvider: HubProvider;
  public readonly config: ConfigService;
  public readonly spoke: SpokeService;

  constructor({ hubProvider, config, spoke }: BridgeServiceConstructorParams) {
    this.config = config;
    this.hubProvider = hubProvider;
    this.spoke = spoke;
  }

  /**
   * Calculates the partner fee deducted from a given bridge input amount.
   *
   * Returns `0n` when no partner fee is configured. The fee is denominated in the
   * same units as `inputAmount` (vault token decimals, 18 dp).
   *
   * @param inputAmount - Gross amount being bridged, in vault token base units.
   * @returns Fee amount to be deducted, in the same units as `inputAmount`.
   */
  public getFee(inputAmount: bigint): bigint {
    if (!this.config.bridge.partnerFee) {
      return 0n;
    }

    return calculateFeeAmount(inputAmount, this.config.bridge.partnerFee);
  }

  /**
   * Checks whether the caller has sufficient token allowance to execute the bridge.
   *
   * The required spender varies by chain type:
   * - Hub (Sonic): the caller's hub wallet router contract
   * - EVM spoke: the spoke chain's asset manager contract
   * - Stellar: validated by the Stellar spoke service (no explicit spender needed)
   * - All other chain types (e.g. Solana, NEAR, Bitcoin): returns `true` — approvals are not applicable.
   *
   * @param _params - Bridge parameters containing source chain, token, amount, and sender address.
   * @returns `Result<boolean>` — `true` if the allowance covers the bridge amount, `false` otherwise.
   */
  public async isAllowanceValid<S extends SpokeChainKey, Raw extends boolean>(
    _params: BridgeParams<S, Raw>,
  ): Promise<Result<boolean, BridgeAllowanceCheckError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey };
    try {
      bridgeInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      bridgeInvariant(params.srcToken.length > 0, 'Source asset is required', { ...baseCtx, field: 'srcToken' });

      // Compute the underlying Result<boolean> across chain-type paths, then wrap any
      // spoke-layer failure as BRIDGE_ALLOWANCE_CHECK_FAILED at the single return point below.
      let inner: Result<boolean> = { ok: true, value: true };

      if (isHubChainKeyType(params.srcChainKey)) {
        inner = await this.spoke.isAllowanceValid({
          srcChainKey: params.srcChainKey,
          token: params.srcToken,
          amount: params.amount,
          owner: params.srcAddress,
          spender: await this.hubProvider.service.getUserRouter({
            address: params.srcAddress as GetAddressType<HubChainKey>,
            chainId: params.srcChainKey,
          }),
        } satisfies SpokeIsAllowanceValidParamsHub);
      } else if (isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        inner = await this.spoke.isAllowanceValid({
          srcChainKey: params.srcChainKey,
          token: params.srcToken,
          amount: params.amount,
          owner: params.srcAddress,
          spender: this.config.getChainConfig(params.srcChainKey).addresses.assetManager,
        } satisfies SpokeIsAllowanceValidParamsEvmSpoke);
      } else if (isStellarChainKeyType(params.srcChainKey)) {
        inner = await this.spoke.isAllowanceValid({
          srcChainKey: params.srcChainKey,
          token: params.srcToken,
          amount: params.amount,
          owner: params.srcAddress,
        } satisfies SpokeIsAllowanceValidParamsStellar);
      }

      if (inner.ok) return inner;
      return {
        ok: false,
        error: allowanceCheckFailed('bridge', inner.error, baseCtx),
      };
    } catch (error) {
      if (isBridgeAllowanceCheckError(error)) return { ok: false, error };
      return {
        ok: false,
        error: allowanceCheckFailed('bridge', error, baseCtx),
      };
    }
  }

  /**
   * Grants token spending approval required before executing a bridge.
   *
   * Approval targets differ by chain:
   * - Hub (Sonic): approves the caller's hub wallet router contract.
   * - EVM spoke: approves the spoke chain's asset manager contract.
   * - Stellar: delegates to the Stellar spoke service for trustline/allowance handling.
   * - All other chain types: returns an error — approvals are not supported.
   *
   * When `raw` is `true` the encoded transaction is returned without broadcasting.
   * When `raw` is `false` the transaction is signed and submitted via the provided wallet provider.
   *
   * @param _params - Bridge parameters including source chain, token, amount, wallet provider, and `raw` flag.
   * @returns `Result<TxReturnType<K, Raw>>` — encoded transaction data (raw) or submitted transaction hash.
   */
  public async approve<K extends SpokeChainKey, Raw extends boolean>(
    _params: BridgeParams<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>, BridgeApproveError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey };

    const wrapApproveFailure = (cause: unknown) => approveFailed('bridge', cause, baseCtx);

    try {
      bridgeInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      bridgeInvariant(params.srcToken.length > 0, 'Source asset is required', { ...baseCtx, field: 'srcToken' });

      if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        bridgeInvariant(
          isOptionalEvmWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Evm wallet provider.',
          { ...baseCtx, field: 'walletProvider' },
        );
        const spender = isHubChainKeyType(params.srcChainKey)
          ? await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey)
          : this.config.getChainConfig(params.srcChainKey).addresses.assetManager;

        const coreParams = {
          srcChainKey: params.srcChainKey,
          owner: params.srcAddress as GetAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          token: params.srcToken as GetTokenAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          amount: params.amount,
          spender,
        } as const;

        const result = await this.spoke.approve<HubChainKey | EvmSpokeOnlyChainKey, Raw>({
          ...coreParams,
          raw: _params.raw,
          walletProvider: _params.walletProvider,
        } as SpokeApproveParams<HubChainKey | EvmSpokeOnlyChainKey, Raw>);

        if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

        return {
          ok: true,
          value: result.value satisfies TxReturnType<EvmSpokeOnlyChainKey, Raw> as TxReturnType<K, Raw>,
        };
      }

      if (isStellarChainKeyType(params.srcChainKey)) {
        bridgeInvariant(
          isOptionalStellarWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Stellar wallet provider.',
          { ...baseCtx, field: 'walletProvider' },
        );
        const coreParams = {
          srcChainKey: params.srcChainKey,
          token: params.srcToken,
          amount: params.amount,
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

      // Reached only for chains that don't support approval (Solana, NEAR, Bitcoin, etc.).
      // Surface as a validation failure rather than a generic Error so consumers can discriminate.
      bridgeInvariant(
        false,
        'Approval only supported for EVM spoke chains and Stellar',
        { ...baseCtx, field: 'srcChainKey' },
      );
    } catch (error) {
      if (isBridgeApproveError(error)) return { ok: false, error };
      return { ok: false, error: wrapApproveFailure(error) };
    }
  }

  /**
   * Executes a full end-to-end bridge transfer: spoke deposit → relay → hub settlement.
   *
   * Internally calls `createBridgeIntent()` to submit the spoke-side deposit transaction,
   * then waits for the cross-chain relay packet to be confirmed on the hub (Sonic).
   * Use this method for the typical "fire and wait" bridge UX.
   *
   * For manual relay control (e.g. monitoring or batching), use `createBridgeIntent()` directly
   * and handle the relay step yourself.
   *
   * @param _params - Bridge parameters including source/destination chain keys, token addresses,
   *   amount, recipient address, wallet provider, and optional timeout.
   * @returns `Result<TxHashPair>` — `{ srcChainTxHash, dstChainTxHash }` on success,
   *   where `srcChainTxHash` is the spoke deposit tx and `dstChainTxHash` is the hub settlement tx.
   *
   * @example
   * const result = await sodax.bridge.bridge({
   *   params: {
   *     srcChainKey: '0x2105.base',
   *     srcAddress: '0x...',
   *     srcToken: '0x...', // source token address on Base
   *     amount: 1000n,
   *     dstChainKey: '0x89.polygon',
   *     dstToken: '0x...', // destination token address on Polygon
   *     recipient: '0x...',
   *   },
   *   raw: false,
   *   walletProvider: evmWalletProvider,
   *   timeout: 30_000, // optional, defaults to 120 000 ms
   * });
   *
   * if (result.ok) {
   *   const { srcChainTxHash, dstChainTxHash } = result.value;
   * }
   */
  public async bridge<K extends SpokeChainKey>(
    _params: BridgeParams<K, false>,
  ): Promise<Result<TxHashPair, BridgeOrchestrationError>> {
    const { params, timeout } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, dstChainKey: params.dstChainKey };
    try {
      const txResult = await this.createBridgeIntent(_params);
      // CreateBridgeIntentErrorCode ⊂ BridgeOrchestrationErrorCode, so SodaxError narrows correctly.
      if (!txResult.ok) return { ok: false, error: txResult.error };

      const verifyTxHashResult = await this.spoke.verifyTxHash({
        txHash: txResult.value.tx,
        chainKey: params.srcChainKey,
      });
      if (!verifyTxHashResult.ok) {
        return {
          ok: false,
          error: verifyFailed('bridge', verifyTxHashResult.error, baseCtx),
        };
      }

      const packetResult = await relayTxAndWaitPacket({
        srcTxHash: txResult.value.tx,
        data: txResult.value.relayData,
        chainKey: params.srcChainKey,
        relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
        timeout,
      });
      if (!packetResult.ok) return { ok: false, error: mapRelayFailure(packetResult.error, { feature: 'bridge', action: 'bridge', srcChainKey: baseCtx.srcChainKey, dstChainKey: baseCtx.dstChainKey }) };

      return {
        ok: true,
        value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: packetResult.value.dst_tx_hash },
      };
    } catch (error) {
      if (isBridgeOrchestrationError(error)) return { ok: false, error };
      return {
        ok: false,
        error: executionFailed('bridge', error, baseCtx),
      };
    }
  }

  /**
   * Submits the spoke-side deposit transaction that initiates a bridge transfer,
   * without waiting for the cross-chain relay to complete.
   *
   * This is the first step of a bridge operation. After this call succeeds, you must
   * relay the returned `relayData` to the hub (Sonic) via `relayTxAndWaitPacket` or
   * the intent relay API to complete the transfer. The higher-level `bridge()` method
   * does this automatically — use `createBridgeIntent()` only when you need manual relay control.
   *
   * When `raw` is `true`, returns the encoded transaction without broadcasting (useful for
   * transaction simulation or batching). When `raw` is `false`, signs and submits the deposit
   * transaction via the provided wallet provider.
   *
   * Bitcoin is only supported with `raw: false` because it requires the RadFi trading wallet
   * derivation flow.
   *
   * @param _params - Bridge parameters including source/destination chain keys, token addresses,
   *   amount, recipient, wallet provider, `raw` flag, and optional simulation skip flag.
   * @returns `Result<IntentTxResult<K, Raw>>` — on success, `{ tx, relayData }` where
   *   `tx` is the spoke deposit tx hash (or encoded call data when raw), and `relayData`
   *   contains the hub wallet address and encoded hub execution payload needed for relay.
   */
  async createBridgeIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: BridgeParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, BridgeCreateIntentError>> {
    const { params, skipSimulation } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, dstChainKey: params.dstChainKey };
    try {
      bridgeInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      const srcToken = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, params.srcToken);
      const dstToken = this.config.getSpokeTokenFromOriginalAssetAddress(params.dstChainKey, params.dstToken);

      // Vault can only be used on Sonic
      bridgeInvariant(srcToken, `Unsupported spoke chain (${params.srcChainKey}) token: ${params.srcToken}`,
        { ...baseCtx, field: 'srcToken' });
      // destination
      bridgeInvariant(dstToken, `Unsupported spoke chain (${params.dstChainKey}) token: ${params.dstToken}`,
        { ...baseCtx, field: 'dstToken' });

      const personalAddress = params.srcAddress;
      // Bitcoin TRADING mode: use trading wallet for hub wallet derivation (see getEffectiveWalletAddress)
      // NOTE: bitcoin is only enabled in non-raw execution mode == walletProvider is required
      let walletAddress: string = personalAddress;
      if (isBitcoinChainKeyType(params.srcChainKey) && _params.raw === false) {
        bridgeInvariant(
          isBitcoinWalletProviderType(_params.walletProvider),
          `Invalid wallet provider for chain key: ${params.srcChainKey}. Expected bitcoin wallet provider.`,
          { ...baseCtx, field: 'walletProvider' },
        );
        walletAddress = await this.spoke.bitcoin.getEffectiveWalletAddress(personalAddress);
        await this.spoke.bitcoin.radfi.ensureRadfiAccessToken(_params.walletProvider);
      }

      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);

      const data: Hex = this.buildBridgeData(params, srcToken, dstToken, this.config.bridge.partnerFee);

      const coreParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: walletAddress as GetAddressType<K>,
        to: hubWallet,
        token: params.srcToken as GetTokenAddressType<K>,
        amount: params.amount,
        data,
        skipSimulation,
      } as const;

      const txResult = await this.spoke.deposit(
        _params.raw
          ? {
              ...coreParams,
              raw: true,
            }
          : {
              ...coreParams,
              raw: false,
              walletProvider: _params.walletProvider as GetWalletProviderType<K>,
            },
      );

      if (!txResult.ok) {
        console.error(txResult.error);
        if (isBridgeCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('bridge', txResult.error, baseCtx),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
          relayData: { address: hubWallet, payload: data },
        },
      };
    } catch (error) {
      console.error(error);
      if (isBridgeCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('bridge', error, baseCtx),
      };
    }
  }

  /**
   * Encodes the hub-side execution payload for a bridge operation.
   *
   * Produces an ABI-encoded sequence of contract calls that the hub wallet router
   * will execute on Sonic after receiving the cross-chain message. The sequence is:
   * 1. (if src is not a vault token) `approve` + `deposit` into the source vault → vault shares
   * 2. (if partner fee configured) `transfer` fee shares to the partner address
   * 3. (if dst is not a vault token) `withdraw` from the destination vault → underlying tokens
   * 4. Transfer to the destination: direct ERC-20 transfer (hub destination) or
   *    asset manager cross-chain transfer (spoke destination), or native S unwrap via `withdrawTo`
   *    when the destination token is the Sonic native token.
   *
   * @param params - Intent parameters carrying source/destination chain keys, token addresses,
   *   amount, and recipient.
   * @param srcToken - Resolved source `XToken` with hub asset and vault addresses.
   * @param dstToken - Resolved destination `XToken` with hub asset and vault addresses.
   * @param partnerFee - Optional partner fee config; if present and non-zero, a fee transfer
   *   call is prepended before the withdrawal step.
   * @returns ABI-encoded `Hex` string representing the ordered call batch for the hub router.
   * @throws When `dstToken` cannot be resolved for the destination chain (invariant).
   */
  buildBridgeData(
    params: CreateBridgeIntentParams,
    srcToken: XToken,
    dstToken: XToken,
    partnerFee: PartnerFee | undefined,
  ): Hex {
    const calls: EvmContractCall[] = [];
    let translatedAmount = params.amount;
    let srcVault = params.srcToken as `0x${string}`;
    // if src asset is not a vault token, we need to approve and deposit into the vault
    if (!this.config.isValidVault(srcToken.hubAsset)) {
      calls.push(Erc20Service.encodeApprove(srcToken.hubAsset, srcToken.vault, params.amount));
      calls.push(EvmVaultTokenService.encodeDeposit(srcToken.vault, srcToken.hubAsset, params.amount));
      translatedAmount = EvmVaultTokenService.translateIncomingDecimals(srcToken.decimals, params.amount);
      srcVault = srcToken.vault;
    }
    const feeAmount = calculateFeeAmount(translatedAmount, partnerFee);

    if (partnerFee && feeAmount > 0n) {
      calls.push(Erc20Service.encodeTransfer(srcVault, partnerFee.address, feeAmount));
    }

    const withdrawAmount = translatedAmount - feeAmount;
    let translatedWithdrawAmount = withdrawAmount;

    // if dst asset is not a vault token, we need to withdraw from the vault
    if (!this.config.isValidVault(dstToken.hubAsset)) {
      calls.push(EvmVaultTokenService.encodeWithdraw(dstToken.vault, dstToken.hubAsset, withdrawAmount));
      translatedWithdrawAmount = EvmVaultTokenService.translateOutgoingDecimals(dstToken.decimals, withdrawAmount);
    }

    const encodedRecipientAddress = encodeAddress(params.dstChainKey, params.recipient);
    // If the destination chain is Sonic, we can directly transfer the tokens to the recipient
    if (isHubChainKey(params.dstChainKey)) {
      // If destination token is S, then unwrap and send S to the recipient
      if (params.dstToken.toLowerCase() === this.hubProvider.chainConfig.nativeToken.toLowerCase()) {
        calls.push({
          address: dstToken.hubAsset,
          value: 0n,
          data: encodeFunctionData({
            abi: wrappedSonicAbi,
            functionName: 'withdrawTo',
            args: [encodedRecipientAddress, translatedWithdrawAmount],
          }),
        });
      } else {
        calls.push(Erc20Service.encodeTransfer(dstToken.hubAsset, encodedRecipientAddress, translatedWithdrawAmount));
      }
    } else {
      bridgeInvariant(dstToken, `Unsupported hub chain (${params.dstChainKey}) token: ${params.dstToken}`,
        { dstChainKey: params.dstChainKey, field: 'dstToken' });
      calls.push(
        EvmAssetManagerService.encodeTransfer(
          dstToken.hubAsset,
          encodedRecipientAddress,
          translatedWithdrawAmount,
          this.hubProvider.chainConfig.addresses.assetManager,
        ),
      );
    }
    return encodeContractCalls(calls);
  }

  /**
   * Returns the maximum amount that can currently be bridged between two tokens,
   * taking into account both deposit capacity on the source side and withdrawal liquidity
   * on the destination side.
   *
   * The limit type depends on the transfer direction:
   * - Spoke → Hub: constrained by the source vault's remaining deposit capacity (`DEPOSIT_LIMIT`).
   * - Hub → Spoke: constrained by the asset manager balance on the destination spoke (`WITHDRAWAL_LIMIT`).
   * - Spoke → Spoke: the minimum of the deposit capacity (source) and the asset manager balance
   *   (destination), normalised to a common unit for comparison. The returned `type` indicates
   *   which side is the binding constraint.
   *
   * Returns `{ amount: 0n, type: 'DEPOSIT_LIMIT' }` when the source token is not yet supported
   * by the vault (i.e. `isSupported` is false on a non-hub source chain).
   *
   * @param from - Source `XToken` (chain key + address) to bridge from.
   * @param to - Destination `XToken` (chain key + address) to bridge to.
   * @returns `Result<BridgeLimit>` — `{ amount, decimals, type }` where `amount` is the maximum
   *   bridgeable quantity in the token's native base units and `decimals` is its decimal precision.
   */
  public async getBridgeableAmount(from: XToken, to: XToken): Promise<Result<BridgeLimit, BridgeLookupError>> {
    const baseCtx = { srcChainKey: from.chainKey, dstChainKey: to.chainKey };
    try {
      const fromToken = this.config.getSpokeTokenFromOriginalAssetAddress(from.chainKey, from.address);
      const toToken = this.config.getSpokeTokenFromOriginalAssetAddress(to.chainKey, to.address);

      bridgeInvariant(fromToken, `Token not found for token ${from.address} on chain ${from.chainKey}`,
        { ...baseCtx, field: 'from' });
      bridgeInvariant(toToken, `Token not found for token ${to.address} on chain ${to.chainKey}`,
        { ...baseCtx, field: 'to' });
      bridgeInvariant(this.isBridgeable({ from, to }), `Tokens ${from.address} and ${to.address} are not bridgeable`,
        { ...baseCtx });

      // we need to check the max deposit of the token on the from chain and the asset manager balance on the to chain
      const [tokenInfos, reserves] = await Promise.all([
        EvmVaultTokenService.getTokenInfos(
          fromToken.vault,
          [fromToken.hubAsset, toToken.hubAsset],
          this.hubProvider.publicClient,
        ),
        EvmVaultTokenService.getVaultReserves(toToken.vault, this.hubProvider.publicClient),
      ]);

      bridgeInvariant(tokenInfos.length === 2, `Expected 2 token infos, got ${tokenInfos.length}`, baseCtx);
      const [fromTokenInfo, toTokenInfo] = tokenInfos;
      bridgeInvariant(fromTokenInfo, 'From token info not found', { ...baseCtx, field: 'from' });
      bridgeInvariant(toTokenInfo, 'To token info not found', { ...baseCtx, field: 'to' });

      // if the from token to be deposited is not supported, we return 0
      if (from.chainKey !== this.hubProvider.chainConfig.chain.key && !fromTokenInfo.isSupported) {
        return {
          ok: true,
          value: {
            amount: 0n,
            decimals: fromTokenInfo.decimals,
            type: 'DEPOSIT_LIMIT',
          },
        };
      }

      // spoke -> hub, we need to check the max deposit of the token on the from chain
      if (!isHubChainKey(from.chainKey) && isHubChainKey(to.chainKey)) {
        const fromTokenDepositedAmount = this.findTokenBalanceInReserves(reserves, from);
        const availableDeposit = fromTokenInfo.maxDeposit - fromTokenDepositedAmount;

        return {
          ok: true,
          value: {
            amount: availableDeposit,
            decimals: fromTokenInfo.decimals,
            type: 'DEPOSIT_LIMIT',
          },
        };
      }

      // hub -> spoke, we need to check the asset manager balance on the to chain
      if (isHubChainKey(from.chainKey) && !isHubChainKey(to.chainKey)) {
        return {
          ok: true,
          value: {
            amount: this.findTokenBalanceInReserves(reserves, to),
            decimals: toTokenInfo.decimals,
            type: 'WITHDRAWAL_LIMIT',
          },
        };
      }

      // spoke -> spoke, we need to check the deposit available on the from chain and the withdrawable asset manager balance on the to chain
      const fromTokenDepositedAmount = this.findTokenBalanceInReserves(reserves, from);
      const availableDeposit = fromTokenInfo.maxDeposit - fromTokenDepositedAmount;
      const assetManagerBalance = this.findTokenBalanceInReserves(reserves, to);
      const availableDepositNormalised = BigNumber(availableDeposit).shiftedBy(-fromTokenInfo.decimals);
      const assetManagerBalanceNormalised = BigNumber(assetManagerBalance).shiftedBy(-toTokenInfo.decimals);

      // return the minimum of the deposit available and the withdrawable asset manager balance
      return {
        ok: true,
        value: availableDepositNormalised.isLessThan(assetManagerBalanceNormalised)
          ? { amount: availableDeposit, decimals: fromTokenInfo.decimals, type: 'DEPOSIT_LIMIT' }
          : { amount: assetManagerBalance, decimals: toTokenInfo.decimals, type: 'WITHDRAWAL_LIMIT' },
      };
    } catch (error) {
      console.error(error);
      if (isBridgeLookupError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('bridge', 'getBridgeableAmount', error, baseCtx),
      };
    }
  }

  /**
   * Determines whether two tokens (potentially on different chains) can be bridged to each other.
   *
   * Two tokens are bridgeable if they resolve to the same vault address on the Sonic hub,
   * meaning they represent the same underlying asset across chains (e.g. USDC on Base and
   * USDC on Arbitrum both map to the same hub vault).
   *
   * Returns `false` — rather than throwing — on any resolution or validation error.
   *
   * @param from - Source `XToken` to bridge from.
   * @param to - Destination `XToken` to bridge to.
   * @param unchecked - When `true`, skips the `isValidSpokeChainKey` guard. Useful for
   *   checking theoretical bridgeability without requiring both chains to be in the active config.
   * @returns `true` if the tokens share the same hub vault; `false` otherwise.
   */
  public isBridgeable({
    from,
    to,
    unchecked = false,
  }: {
    from: XToken;
    to: XToken;
    unchecked?: boolean;
  }): boolean {
    try {
      if (!unchecked) {
        bridgeInvariant(this.config.isValidSpokeChainKey(from.chainKey), `Invalid spoke chain (${from.chainKey})`,
          { srcChainKey: from.chainKey, field: 'from' });
        bridgeInvariant(this.config.isValidSpokeChainKey(to.chainKey), `Invalid spoke chain (${to.chainKey})`,
          { dstChainKey: to.chainKey, field: 'to' });
      }

      // Get hub asset info for both source and destination assets
      const srcToken = this.config.getSpokeTokenFromOriginalAssetAddress(from.chainKey, from.address);
      const dstToken = this.config.getSpokeTokenFromOriginalAssetAddress(to.chainKey, to.address);

      // Check if both assets are supported and have vault information
      bridgeInvariant(srcToken, `Token not found for token ${from.address} on chain ${from.chainKey}`,
        { srcChainKey: from.chainKey, field: 'from' });
      bridgeInvariant(dstToken, `Token not found for token ${to.address} on chain ${to.chainKey}`,
        { dstChainKey: to.chainKey, field: 'to' });

      // Check if the vault addresses are the same (case-insensitive comparison)
      return srcToken.vault.toLowerCase() === dstToken.vault.toLowerCase();
    } catch (error) {
      console.error(error);

      // Return false on any error
      return false;
    }
  }

  /**
   * Returns all tokens on the destination chain that can receive a bridge from the given source token.
   *
   * Filters the destination chain's supported tokens to those that share the same hub vault
   * as the source token, which means they represent the same underlying asset.
   *
   * @param from - Source chain key.
   * @param to - Destination chain key whose supported tokens are searched.
   * @param token - Source token address on `from`.
   * @returns `Result<XToken[]>` — array of destination-chain tokens bridgeable from the source token.
   *   Returns an error result if the source token is not found in the config.
   */
  public getBridgeableTokens(
    from: SpokeChainKey,
    to: SpokeChainKey,
    token: string,
  ): Result<XToken[], BridgeLookupError> {
    const baseCtx = { srcChainKey: from, dstChainKey: to };
    try {
      const srcToken = this.config.getSpokeTokenFromOriginalAssetAddress(from, token);
      bridgeInvariant(srcToken, `Token not found for token ${token} on chain ${from}`,
        { ...baseCtx, field: 'token' });

      return {
        ok: true,
        value: this.filterTokensWithSameVault(this.config.spokeChainConfig[to].supportedTokens, to, srcToken),
      };
    } catch (error) {
      if (isBridgeLookupError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('bridge', 'getBridgeableTokens', error, baseCtx),
      };
    }
  }

  /**
   * Filters a token map to those that share the same hub vault as `srcToken`.
   *
   * Used by `getBridgeableTokens()` to narrow the destination chain's full token list to only
   * the tokens that are bridgeable from the given source. Each matching token is returned with
   * its `chainKey` set to `to`.
   *
   * @param tokens - Map of raw token entries from the destination chain's config.
   * @param to - Destination chain key; applied to each returned token's `chainKey`.
   * @param srcToken - Resolved source `XToken` to match vaults against. Returns empty array when `undefined`.
   * @returns Array of destination-chain `XToken` instances whose vault matches `srcToken.vault`.
   */
  public filterTokensWithSameVault(
    tokens: Record<string, XToken>,
    to: SpokeChainKey,
    srcToken: XToken | undefined,
  ): XToken[] {
    // Filter tokens that share the same vault as the source asset
    const bridgeableTokens: XToken[] = [];

    for (const token of Object.values(tokens)) {
      const dstToken = this.config.getSpokeTokenFromOriginalAssetAddress(to, token.address);

      if (dstToken && srcToken && dstToken.vault.toLowerCase() === srcToken.vault.toLowerCase()) {
        bridgeableTokens.push({
          ...token,
          chainKey: to,
        });
      }
    }

    return bridgeableTokens;
  }

  /**
   * Looks up a token's balance within a vault's reserve snapshot.
   *
   * Resolves the token to its hub asset address via config, then finds the matching index
   * in `reserves.tokens` (case-insensitive) and returns the corresponding balance from
   * `reserves.balances`. Used by `getBridgeableAmount()` to determine deposit capacity
   * and asset manager withdrawal liquidity.
   *
   * @param reserves - Vault reserve snapshot containing parallel `tokens` and `balances` arrays.
   * @param token - `XToken` whose on-chain balance should be retrieved from the reserves.
   * @returns The token balance held in the vault, in the token's native base units.
   * @throws When the token is not found in config or not present in the reserves snapshot.
   */
  public findTokenBalanceInReserves(reserves: VaultReserves, token: XToken): bigint {
    const hubAsset = this.config.getSpokeTokenFromOriginalAssetAddress(token.chainKey, token.address);
    bridgeInvariant(hubAsset, `Token not found for token ${token.address} on chain ${token.chainKey}`,
      { srcChainKey: token.chainKey, field: 'token' });
    const tokenIndex = reserves.tokens.findIndex(t => t.toLowerCase() === hubAsset.hubAsset.toLowerCase());
    bridgeInvariant(
      tokenIndex !== -1,
      `Token ${hubAsset.hubAsset} not found in the vault reserves for chain ${token.chainKey}`,
      { srcChainKey: token.chainKey, field: 'token' },
    );
    return reserves.balances[tokenIndex] ?? 0n;
  }
}
