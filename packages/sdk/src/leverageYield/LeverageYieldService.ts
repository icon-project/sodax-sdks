import {
  type SpokeService,
  Erc20Service,
  Erc4626Service,
  EvmAssetManagerService,
  EvmVaultTokenService,
  encodeContractCalls,
  encodeAddress,
  isBitcoinChainKeyType,
  isBitcoinWalletProviderType,
  isEvmSpokeOnlyChainKeyType,
  isHubChainKeyType,
  isOptionalEvmWalletProviderType,
  relayTxAndWaitPacket,
  type SpokeApproveParams,
  type SpokeIsAllowanceValidParamsEvmSpoke,
  type SpokeIsAllowanceValidParamsHub,
} from '../shared/index.js';
import type { HubProvider, IntentTxResult, TxHashPair } from '../shared/types/types.js';
import type {
  Address,
  EvmContractCall,
  EvmReturnType,
  EvmSpokeOnlyChainKey,
  GetAddressType,
  GetTokenAddressType,
  GetWalletProviderType,
  Hex,
  HubChainKey,
  IEvmWalletProvider,
  LeverageYieldVault,
  Result,
  SpokeChainKey,
  SpokeExecActionParams,
  TxReturnType,
} from '@sodax/types';
import { parseAbi } from 'viem';
import type { ConfigService } from '../shared/config/ConfigService.js';
import {
  allowanceCheckFailed,
  approveFailed,
  executionFailed,
  intentCreationFailed,
  lookupFailed,
  verifyFailed,
} from '../errors/wrappers.js';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import {
  isLeverageYieldAllowanceCheckError,
  isLeverageYieldApproveError,
  isLeverageYieldCreateIntentError,
  isLeverageYieldDirectError,
  isLeverageYieldLookupError,
  isLeverageYieldOrchestrationError,
  type LeverageYieldAllowanceCheckError,
  type LeverageYieldApproveError,
  type LeverageYieldCreateIntentError,
  type LeverageYieldDirectError,
  type LeverageYieldLookupError,
  type LeverageYieldOrchestrationError,
  leverageYieldInvariant,
} from './errors.js';

// ─── ABIs ─────────────────────────────────────────────────────────────────
//
// Standard ERC-4626 lives in `@sodax/sdk/shared/abis/erc4626.abi`. The leverage vault
// adds a single non-standard view (`getPositionDetails`) used for read-only position
// snapshots — keep that fragment here so we don't pollute the shared ABI directory
// with vault-specific declarations.
const leverageYieldVaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function getPositionDetails() view returns (uint256 collateral, uint256 debt, uint256 ltv, uint256 healthFactor, uint256 idleAsset)',
]);

// ─── Param types ──────────────────────────────────────────────────────────

export type LeverageYieldPosition = {
  collateral: bigint;
  debt: bigint;
  ltv: bigint;
  healthFactor: bigint;
  idleAsset: bigint;
};

export type CreateLeverageYieldXDepositParams<K extends SpokeChainKey = SpokeChainKey> = {
  /** Hub-side LeverageYieldVault proxy address. */
  vault: Address;
  /** User's address on the spoke chain. */
  srcAddress: string;
  /** Spoke chain key (origin of the bridge). */
  srcChainKey: K;
  /** Spoke-side token to deposit (e.g. weETH on Arbitrum). */
  srcToken: string;
  /** Amount in `srcToken` decimals. Translated to vault-token decimals internally. */
  amount: bigint;
  /**
   * Hub-side address that will receive the leverage-vault shares. Defaults to the
   * derived hub wallet of `srcAddress`.
   */
  receiver?: Address;
};

export type LeverageYieldXDepositParams<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  CreateLeverageYieldXDepositParams<K>
>;

export type CreateLeverageYieldXWithdrawParams<K extends SpokeChainKey = SpokeChainKey> = {
  /** Hub-side LeverageYieldVault proxy address. */
  vault: Address;
  /** User's address on the spoke chain (also drives hub-wallet derivation). */
  srcAddress: string;
  /** Spoke chain key — the message originates here AND the bridged tokens land back here. */
  srcChainKey: K;
  /** Spoke-side token to receive (typically the same one used at deposit time). */
  dstToken: string;
  /**
   * Amount in vault-asset units (sodaWEETH-style, 18 decimals). Pass the result of
   * {@link LeverageYieldService.getMaxWithdraw} or less.
   */
  amount: bigint;
  /** Spoke-side recipient. Defaults to `srcAddress`. */
  recipient?: string;
};

export type LeverageYieldXWithdrawParams<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  CreateLeverageYieldXWithdrawParams<K>
>;

export type LeverageYieldDirectDepositParams<R extends boolean> = {
  vault: Address;
  /** Amount in vault-asset units (sodaWEETH, 18 decimals). */
  assets: bigint;
  receiver: Address;
  walletProvider: IEvmWalletProvider;
  raw?: R;
};

export type LeverageYieldDirectWithdrawParams<R extends boolean> = {
  vault: Address;
  /** Amount in vault-asset units (sodaWEETH, 18 decimals). */
  assets: bigint;
  receiver: Address;
  owner: Address;
  walletProvider: IEvmWalletProvider;
  raw?: R;
};

export type LeverageYieldApproveParams<R extends boolean> = {
  vault: Address;
  /** Amount of the vault's underlying asset to approve. */
  amount: bigint;
  walletProvider: IEvmWalletProvider;
  raw?: R;
};

export type LeverageYieldAllowanceParams = {
  vault: Address;
  amount: bigint;
  owner: Address;
};

export type LeverageYieldServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
  spoke: SpokeService;
};

/**
 * Orchestrates deposits into and withdrawals out of Sodax leverage-yield ERC-4626 vaults.
 *
 * Architecture mirrors {@link BridgeService}: a cross-chain spoke deposit (or `sendMessage`)
 * carries an encoded sequence of contract calls executed on the hub by the user's
 * deterministic hub wallet. The SDK composes that sequence from existing encoders in
 * `@sodax/sdk` — `Erc20Service`, `EvmVaultTokenService`, `Erc4626Service`,
 * `EvmAssetManagerService` — so the leverage-yield-specific surface is small.
 *
 * Methods:
 * - `xdeposit` / `xwithdraw` — full cross-chain orchestration; return `[srcTx, dstTx]`.
 * - `createXDepositIntent` / `createXWithdrawIntent` — spoke-side only; caller drives relay.
 * - `deposit` / `withdraw` / `approve` — Sonic-direct calls for users already holding
 *   the vault's underlying asset (sodaWEETH-style) on the hub.
 * - `getPosition` / `getMaxWithdraw` / `previewDeposit` / `previewWithdraw` — reads.
 * - `listVaults` / `getVault` — registry lookup over `config.leverageYield.vaults`.
 */
export class LeverageYieldService {
  public readonly hubProvider: HubProvider;
  public readonly config: ConfigService;
  public readonly spoke: SpokeService;

  constructor({ hubProvider, config, spoke }: LeverageYieldServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.config = config;
    this.spoke = spoke;
  }

  // ─── Registry ──────────────────────────────────────────────────────────

  /** Returns the static registry of known leverage-yield vaults. */
  public listVaults(): readonly LeverageYieldVault[] {
    return this.config.sodaxConfig.leverageYield.vaults;
  }

  /** Looks up a vault by its `name` field. Returns `undefined` when not registered. */
  public getVault(name: string): LeverageYieldVault | undefined {
    return this.listVaults().find(v => v.name === name);
  }

  /**
   * Looks up a registered vault by its on-chain proxy address (case-insensitive).
   * Returns `undefined` when the address isn't in the registry — `xdeposit`/`xwithdraw` then
   * skip the `asset` cross-check and rely on the hub `simulateRecvMessage` to catch any
   * vault-asset mismatch downstream.
   */
  public getVaultByAddress(address: Address): LeverageYieldVault | undefined {
    const normalized = address.toLowerCase();
    return this.listVaults().find(v => v.vault.toLowerCase() === normalized);
  }

  // ─── Cross-chain pre-flight (xdeposit only) ────────────────────────────
  //
  // `xdeposit` performs a spoke-side `SpokeAssetManager.transfer(...)` which pulls
  // `srcToken` from the user's EOA via `transferFrom`. The user must therefore approve
  // the spoke chain's asset manager (or, on Sonic-as-source, their hub-wallet router)
  // before calling `xdeposit` — otherwise the spoke tx reverts with
  // `ERC20: transfer amount exceeds allowance`.
  //
  // `xwithdraw` does NOT need a spoke-side allowance: it only sends a cross-chain message
  // via `Connection.sendMessage(...)`, which doesn't move tokens on the spoke side.

  /**
   * Checks whether the caller has already approved the spoke-side spender (asset manager
   * for EVM spokes, hub-wallet router for Sonic-as-source) for an `xdeposit` of `amount`.
   * Returns `true` when the allowance covers `amount`. Mirrors {@link BridgeService.isAllowanceValid}.
   *
   * For non-EVM, non-hub spokes (Solana, NEAR, Bitcoin, etc.) returns `true` — those chains
   * don't use ERC-20-style allowances. Stellar is not supported by `xdeposit` in v1.
   */
  public async isXDepositAllowanceValid<S extends SpokeChainKey, Raw extends boolean>(
    _params: LeverageYieldXDepositParams<S, Raw>,
  ): Promise<Result<boolean, LeverageYieldAllowanceCheckError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'xdeposit' as const };
    try {
      leverageYieldInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      leverageYieldInvariant(params.srcToken.length > 0, 'Source token is required', {
        ...baseCtx,
        field: 'srcToken',
      });

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
      }

      if (inner.ok) return inner;
      return { ok: false, error: allowanceCheckFailed('leverageYield', inner.error, baseCtx) };
    } catch (error) {
      if (isLeverageYieldAllowanceCheckError(error)) return { ok: false, error };
      return { ok: false, error: allowanceCheckFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Approves the spoke-side spender so that {@link xdeposit} can move `srcToken` into
   * the bridge. Mirrors {@link BridgeService.approve}.
   *
   * - EVM spoke: approves `config.addresses.assetManager`.
   * - Hub (Sonic) as source: approves the user's hub-wallet router.
   * - Other chain types: returns a `VALIDATION_FAILED` — approvals not applicable.
   */
  public async xdepositApprove<K extends SpokeChainKey, Raw extends boolean>(
    _params: LeverageYieldXDepositParams<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>, LeverageYieldApproveError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'xdeposit' as const };

    const wrapApproveFailure = (cause: unknown) => approveFailed('leverageYield', cause, baseCtx);

    try {
      leverageYieldInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      leverageYieldInvariant(params.srcToken.length > 0, 'Source token is required', {
        ...baseCtx,
        field: 'srcToken',
      });

      if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        leverageYieldInvariant(
          isOptionalEvmWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected EVM wallet provider.',
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

      // Non-EVM chains: approval is not applicable in the SpokeAssetManager pull model.
      leverageYieldInvariant(false, 'xdepositApprove only supported for EVM spoke chains and Sonic hub', {
        ...baseCtx,
        field: 'srcChainKey',
      });
    } catch (error) {
      if (isLeverageYieldApproveError(error)) return { ok: false, error };
      return { ok: false, error: wrapApproveFailure(error) };
    }
  }

  // ─── Cross-chain orchestration ─────────────────────────────────────────

  /**
   * Cross-chain deposit: bridges `srcToken` from the spoke into the user's hub wallet,
   * which then wraps it into the vault's underlying asset and deposits into the leverage
   * vault. Returns `{ srcChainTxHash, dstChainTxHash }` once the relay packet is executed.
   *
   * `params.receiver` defaults to the derived hub wallet of `srcAddress`.
   */
  public async xdeposit<K extends SpokeChainKey>(
    _params: LeverageYieldXDepositParams<K, false>,
  ): Promise<Result<TxHashPair, LeverageYieldOrchestrationError>> {
    const { params, timeout } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'xdeposit' as const };
    try {
      const txResult = await this.createXDepositIntent(_params);
      if (!txResult.ok) return { ok: false, error: txResult.error };

      const verifyTxHashResult = await this.spoke.verifyTxHash({
        txHash: txResult.value.tx,
        chainKey: params.srcChainKey,
      });
      if (!verifyTxHashResult.ok) {
        return { ok: false, error: verifyFailed('leverageYield', verifyTxHashResult.error, baseCtx) };
      }

      const packetResult = await relayTxAndWaitPacket({
        srcTxHash: txResult.value.tx,
        data: txResult.value.relayData,
        chainKey: params.srcChainKey,
        relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
        timeout,
      });
      if (!packetResult.ok) {
        return {
          ok: false,
          error: mapRelayFailure(packetResult.error, {
            feature: 'leverageYield',
            action: 'xdeposit',
            srcChainKey: params.srcChainKey,
          }),
        };
      }

      return {
        ok: true,
        value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: packetResult.value.dst_tx_hash },
      };
    } catch (error) {
      if (isLeverageYieldOrchestrationError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Submits the spoke-side bridge transaction that initiates an `xdeposit`, without
   * waiting for the relay. Caller is responsible for relaying / polling. Mirrors
   * {@link BridgeService.createBridgeIntent}.
   */
  public async createXDepositIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: LeverageYieldXDepositParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, LeverageYieldCreateIntentError>> {
    const { params, skipSimulation } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'xdeposit' as const };
    try {
      leverageYieldInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      leverageYieldInvariant(params.vault.length > 0, 'Vault address is required', { ...baseCtx, field: 'vault' });
      leverageYieldInvariant(params.srcToken.length > 0, 'Source token is required', { ...baseCtx, field: 'srcToken' });

      const srcToken = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, params.srcToken);
      leverageYieldInvariant(
        srcToken,
        `Unsupported spoke chain (${params.srcChainKey}) token: ${params.srcToken}`,
        { ...baseCtx, field: 'srcToken' },
      );

      // If the leverage vault is in the registry, fast-fail when the user's spoke token
      // doesn't map to its underlying. Without this, the mismatch only surfaces during the
      // hub-side `simulateRecvMessage` (or worse, after broadcast) as a generic vault revert.
      // Vaults outside the registry are trusted to the simulation step.
      const registered = this.getVaultByAddress(params.vault);
      if (registered) {
        leverageYieldInvariant(
          registered.asset.toLowerCase() === srcToken.vault.toLowerCase(),
          `Vault '${registered.name}' (${registered.vault}) accepts ${registered.asset}, but spoke token ${params.srcToken} maps to ${srcToken.vault}. Use a different vault or a different srcToken.`,
          { ...baseCtx, field: 'srcToken' },
        );
      }

      // Bitcoin TRADING mode: derive the trading wallet for hub-wallet keying.
      let walletAddress: string = params.srcAddress;
      if (isBitcoinChainKeyType(params.srcChainKey) && _params.raw === false) {
        leverageYieldInvariant(
          isBitcoinWalletProviderType(_params.walletProvider),
          `Invalid wallet provider for chain key: ${params.srcChainKey}. Expected bitcoin wallet provider.`,
          { ...baseCtx, field: 'walletProvider' },
        );
        walletAddress = await this.spoke.bitcoin.getEffectiveWalletAddress(params.srcAddress);
        await this.spoke.bitcoin.radfi.ensureRadfiAccessToken(_params.walletProvider);
      }

      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
      const receiver = params.receiver ?? hubWallet;

      const data = this.buildXDepositHookData({
        hubAsset: srcToken.hubAsset,
        sodaAsset: srcToken.vault,
        spokeDecimals: srcToken.decimals,
        leverageVault: params.vault,
        amount: params.amount,
        receiver,
      });

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
          ? { ...coreParams, raw: true }
          : { ...coreParams, raw: false, walletProvider: _params.walletProvider as GetWalletProviderType<K> },
      );

      if (!txResult.ok) {
        if (isLeverageYieldCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return { ok: false, error: intentCreationFailed('leverageYield', txResult.error, baseCtx) };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
          relayData: { address: hubWallet, payload: data },
        },
      };
    } catch (error) {
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Cross-chain withdraw: burns `amount` (vault-asset units, 18 decimals) of leverage-vault
   * shares held by the user's hub wallet, unwraps the resulting Sodax vault tokens, and
   * bridges the underlying asset back to `recipient` on `srcChainKey`. Returns
   * `{ srcChainTxHash, dstChainTxHash }` once the relay packet is executed.
   *
   * Pre-flight check the on-chain `maxWithdraw` for the user's hub wallet via
   * {@link LeverageYieldService.getMaxWithdrawForUser} — amounts above the synchronous
   * cap require deleverage first.
   */
  public async xwithdraw<K extends SpokeChainKey>(
    _params: LeverageYieldXWithdrawParams<K, false>,
  ): Promise<Result<TxHashPair, LeverageYieldOrchestrationError>> {
    const { params, timeout } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'xwithdraw' as const };
    try {
      const txResult = await this.createXWithdrawIntent(_params);
      if (!txResult.ok) return { ok: false, error: txResult.error };

      const verifyTxHashResult = await this.spoke.verifyTxHash({
        txHash: txResult.value.tx,
        chainKey: params.srcChainKey,
      });
      if (!verifyTxHashResult.ok) {
        return { ok: false, error: verifyFailed('leverageYield', verifyTxHashResult.error, baseCtx) };
      }

      const packetResult = await relayTxAndWaitPacket({
        srcTxHash: txResult.value.tx,
        data: txResult.value.relayData,
        chainKey: params.srcChainKey,
        relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
        timeout,
      });
      if (!packetResult.ok) {
        return {
          ok: false,
          error: mapRelayFailure(packetResult.error, {
            feature: 'leverageYield',
            action: 'xwithdraw',
            srcChainKey: params.srcChainKey,
          }),
        };
      }

      return {
        ok: true,
        value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: packetResult.value.dst_tx_hash },
      };
    } catch (error) {
      if (isLeverageYieldOrchestrationError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Submits the spoke-side `sendMessage` that initiates an `xwithdraw`, without waiting
   * for the relay. Caller is responsible for relaying / polling.
   */
  public async createXWithdrawIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: LeverageYieldXWithdrawParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, LeverageYieldCreateIntentError>> {
    const { params, skipSimulation } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'xwithdraw' as const };
    try {
      leverageYieldInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      leverageYieldInvariant(params.vault.length > 0, 'Vault address is required', { ...baseCtx, field: 'vault' });
      leverageYieldInvariant(params.dstToken.length > 0, 'Destination token is required', {
        ...baseCtx,
        field: 'dstToken',
      });

      const dstToken = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, params.dstToken);
      leverageYieldInvariant(
        dstToken,
        `Unsupported spoke chain (${params.srcChainKey}) token: ${params.dstToken}`,
        { ...baseCtx, field: 'dstToken' },
      );

      // Same fast-fail asset check as `createXDepositIntent`. The withdraw hook unwraps
      // the leverage vault into the same `sodaAsset` that `dstToken` maps to — if those
      // disagree, the unwrap step reverts on the hub.
      const registered = this.getVaultByAddress(params.vault);
      if (registered) {
        leverageYieldInvariant(
          registered.asset.toLowerCase() === dstToken.vault.toLowerCase(),
          `Vault '${registered.name}' (${registered.vault}) holds ${registered.asset}, but dstToken ${params.dstToken} maps to ${dstToken.vault}. Use a matching dstToken.`,
          { ...baseCtx, field: 'dstToken' },
        );
      }

      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
      const recipientOnSpoke = params.recipient ?? params.srcAddress;
      const encodedRecipient = encodeAddress(params.srcChainKey, recipientOnSpoke);

      const data = this.buildXWithdrawHookData({
        hubAsset: dstToken.hubAsset,
        sodaAsset: dstToken.vault,
        spokeDecimals: dstToken.decimals,
        leverageVault: params.vault,
        vaultAssetAmount: params.amount,
        hubWallet,
        recipientOnSpoke: encodedRecipient,
        assetManager: this.hubProvider.chainConfig.addresses.assetManager,
      });

      const coreParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: params.srcAddress as GetAddressType<K>,
        dstChainKey: this.hubProvider.chainConfig.chain.key,
        dstAddress: hubWallet,
        payload: data,
        skipSimulation,
      } as const;

      const txResult = await this.spoke.sendMessage(
        _params.raw
          ? { ...coreParams, raw: true }
          : { ...coreParams, raw: false, walletProvider: _params.walletProvider as GetWalletProviderType<K> },
      );

      if (!txResult.ok) {
        if (isLeverageYieldCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return { ok: false, error: intentCreationFailed('leverageYield', txResult.error, baseCtx) };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
          relayData: { address: hubWallet, payload: data },
        },
      };
    } catch (error) {
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('leverageYield', error, baseCtx) };
    }
  }

  // ─── Hub-direct (Sonic) ─────────────────────────────────────────────────

  /**
   * Direct vault deposit on the Sonic hub. Use when the caller already holds the vault's
   * underlying asset (sodaWEETH-style) on Sonic. For cross-chain deposits, use
   * {@link LeverageYieldService.xdeposit}.
   */
  public async deposit<R extends boolean = false>(
    params: LeverageYieldDirectDepositParams<R>,
  ): Promise<Result<TxReturnType<HubChainKey, R> | EvmReturnType<true>, LeverageYieldDirectError>> {
    const baseCtx = { action: 'deposit' as const };
    try {
      leverageYieldInvariant(params.assets > 0n, 'Assets must be greater than 0', { ...baseCtx, field: 'assets' });
      leverageYieldInvariant(params.vault.length > 0, 'Vault address is required', { ...baseCtx, field: 'vault' });

      const tx = await Erc4626Service.deposit(
        params.vault,
        params.assets,
        params.receiver,
        params.walletProvider,
        params.raw,
      );
      return { ok: true, value: tx as TxReturnType<HubChainKey, R> };
    } catch (error) {
      if (isLeverageYieldDirectError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Direct vault withdrawal on the Sonic hub. Use when the caller's leverage-vault shares
   * are held by an EOA on Sonic (not by the cross-chain hub wallet). For shares held by
   * the hub wallet derived from a spoke-chain address, use
   * {@link LeverageYieldService.xwithdraw}.
   */
  public async withdraw<R extends boolean = false>(
    params: LeverageYieldDirectWithdrawParams<R>,
  ): Promise<Result<TxReturnType<HubChainKey, R> | EvmReturnType<true>, LeverageYieldDirectError>> {
    const baseCtx = { action: 'withdraw' as const };
    try {
      leverageYieldInvariant(params.assets > 0n, 'Assets must be greater than 0', { ...baseCtx, field: 'assets' });
      leverageYieldInvariant(params.vault.length > 0, 'Vault address is required', { ...baseCtx, field: 'vault' });

      const tx = await Erc4626Service.withdraw(
        params.vault,
        params.assets,
        params.receiver,
        params.owner,
        params.walletProvider,
        params.raw,
      );
      return { ok: true, value: tx as TxReturnType<HubChainKey, R> };
    } catch (error) {
      if (isLeverageYieldDirectError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Approves the vault's underlying asset to the leverage vault on Sonic. Required before
   * a direct {@link LeverageYieldService.deposit}; not required for {@link xdeposit}
   * (the cross-chain hook handles its own approvals on the hub wallet).
   */
  public async approve<R extends boolean = false>(
    params: LeverageYieldApproveParams<R>,
  ): Promise<Result<TxReturnType<HubChainKey, R> | EvmReturnType<true>, LeverageYieldApproveError>> {
    const baseCtx = { action: 'approve' as const };
    try {
      leverageYieldInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      leverageYieldInvariant(params.vault.length > 0, 'Vault address is required', { ...baseCtx, field: 'vault' });

      const assetResult = await this.getAsset(params.vault);
      if (!assetResult.ok) {
        return { ok: false, error: approveFailed('leverageYield', assetResult.error, baseCtx) };
      }

      const from = (await params.walletProvider.getWalletAddress()) as Address;
      const baseApprove = {
        token: assetResult.value,
        amount: params.amount,
        from,
        spender: params.vault,
      } as const;

      if (params.raw) {
        const tx = await Erc20Service.approve<true>({ ...baseApprove, raw: true });
        return { ok: true, value: tx as TxReturnType<HubChainKey, R> };
      }
      const tx = await Erc20Service.approve<false>({
        ...baseApprove,
        raw: false,
        walletProvider: params.walletProvider,
      });
      return { ok: true, value: tx as TxReturnType<HubChainKey, R> };
    } catch (error) {
      if (isLeverageYieldApproveError(error)) return { ok: false, error };
      return { ok: false, error: approveFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Reads on-chain allowance of the vault's underlying asset for `owner → vault`. Returns
   * `true` when the allowance covers `amount`. Use before a direct
   * {@link LeverageYieldService.deposit}.
   */
  public async isAllowanceValid(
    params: LeverageYieldAllowanceParams,
  ): Promise<Result<boolean, LeverageYieldAllowanceCheckError>> {
    const baseCtx = { action: 'deposit' as const };
    try {
      leverageYieldInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });

      const assetResult = await this.getAsset(params.vault);
      if (!assetResult.ok) {
        return { ok: false, error: allowanceCheckFailed('leverageYield', assetResult.error, baseCtx) };
      }

      const allowance = await this.hubProvider.publicClient.readContract({
        address: assetResult.value,
        abi: parseAbi(['function allowance(address,address) view returns (uint256)']),
        functionName: 'allowance',
        args: [params.owner, params.vault],
      });

      return { ok: true, value: allowance >= params.amount };
    } catch (error) {
      if (isLeverageYieldAllowanceCheckError(error)) return { ok: false, error };
      return { ok: false, error: allowanceCheckFailed('leverageYield', error, baseCtx) };
    }
  }

  // ─── Reads ──────────────────────────────────────────────────────────────

  /** ERC-4626 `asset()` of the vault — the sodaWEETH-style underlying. */
  public async getAsset(vault: Address): Promise<Result<Address, LeverageYieldLookupError>> {
    try {
      const value = await this.hubProvider.publicClient.readContract({
        address: vault,
        abi: leverageYieldVaultAbi,
        functionName: 'asset',
      });
      return { ok: true, value };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getAsset', error) };
    }
  }

  /** Reads the vault's leveraged position snapshot via the non-standard `getPositionDetails`. */
  public async getPosition(vault: Address): Promise<Result<LeverageYieldPosition, LeverageYieldLookupError>> {
    try {
      const [collateral, debt, ltv, healthFactor, idleAsset] = await this.hubProvider.publicClient.readContract({
        address: vault,
        abi: leverageYieldVaultAbi,
        functionName: 'getPositionDetails',
      });
      return { ok: true, value: { collateral, debt, ltv, healthFactor, idleAsset } };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getPosition', error) };
    }
  }

  /** Synchronously withdrawable assets for `owner` (clamped against leverage HF floor). */
  public async getMaxWithdraw(vault: Address, owner: Address): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.getMaxWithdraw(vault, owner, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'getMaxWithdraw', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Shares minted for a given asset deposit. */
  public async previewDeposit(vault: Address, assets: bigint): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.previewDeposit(vault, assets, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'previewDeposit', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Shares burned for a given asset withdrawal. */
  public async previewWithdraw(vault: Address, assets: bigint): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.previewWithdraw(vault, assets, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'previewWithdraw', inner.error) };
    return { ok: true, value: inner.value };
  }

  /**
   * Convenience: resolves the user's hub wallet from `(srcChainKey, srcAddress)` and
   * returns its on-chain `maxWithdraw`. Useful pre-flight before {@link xwithdraw}.
   */
  public async getMaxWithdrawForUser<K extends SpokeChainKey>(
    vault: Address,
    srcChainKey: K,
    srcAddress: string,
  ): Promise<Result<bigint, LeverageYieldLookupError>> {
    try {
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey);
      return await this.getMaxWithdraw(vault, hubWallet);
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getMaxWithdrawForUser', error, { srcChainKey }) };
    }
  }

  // ─── Hook composers (private) ──────────────────────────────────────────

  /**
   * Encodes the hub-wallet call sequence for an `xdeposit`. Mirrors the proven
   * leverage-yield-test deposit hook 1:1, expressed via SDK encoders.
   *
   * Sequence (executed by the user's hub wallet on Sonic):
   * 1. `hubAsset.approve(sodaAsset, amount)` — allow the Sodax vault to pull the bridged hub asset
   * 2. `sodaAsset.deposit(hubAsset, amount)` — wrap into vault-token decimals (translated to 18)
   * 3. `sodaAsset.approve(leverageVault, translatedAmount)` — allow the leverage vault to pull
   * 4. `leverageVault.deposit(translatedAmount, receiver)` — mint leverage-vault shares to receiver
   */
  private buildXDepositHookData(args: {
    hubAsset: Address;
    sodaAsset: Address;
    spokeDecimals: number;
    leverageVault: Address;
    amount: bigint;
    receiver: Address;
  }): Hex {
    const translatedAmount = EvmVaultTokenService.translateIncomingDecimals(args.spokeDecimals, args.amount);
    const calls: EvmContractCall[] = [
      Erc20Service.encodeApprove(args.hubAsset, args.sodaAsset, args.amount),
      EvmVaultTokenService.encodeDeposit(args.sodaAsset, args.hubAsset, args.amount),
      Erc20Service.encodeApprove(args.sodaAsset, args.leverageVault, translatedAmount),
      Erc4626Service.encodeDeposit(args.leverageVault, translatedAmount, args.receiver),
    ];
    return encodeContractCalls(calls);
  }

  /**
   * Encodes the hub-wallet call sequence for an `xwithdraw`. Mirrors the proven
   * leverage-yield-test withdraw hook 1:1.
   *
   * Sequence (executed by the user's hub wallet on Sonic):
   * 1. `leverageVault.withdraw(vaultAssetAmount, hubWallet, hubWallet)` — burn shares, receive vault tokens
   * 2. `sodaAsset.withdraw(hubAsset, vaultAssetAmount)` — unwrap vault tokens to hub asset (in spoke decimals)
   * 3. `hubAsset.approve(assetManager, translatedAmount)` — allow the asset manager to pull (matches vault.js)
   * 4. `assetManager.transfer(hubAsset, recipientOnSpoke, translatedAmount, "0x")` — bridge back to spoke
   */
  private buildXWithdrawHookData(args: {
    hubAsset: Address;
    sodaAsset: Address;
    spokeDecimals: number;
    leverageVault: Address;
    vaultAssetAmount: bigint;
    hubWallet: Address;
    recipientOnSpoke: Hex;
    assetManager: Address;
  }): Hex {
    const translatedAmount = EvmVaultTokenService.translateOutgoingDecimals(args.spokeDecimals, args.vaultAssetAmount);
    const calls: EvmContractCall[] = [
      Erc4626Service.encodeWithdraw(args.leverageVault, args.vaultAssetAmount, args.hubWallet, args.hubWallet),
      EvmVaultTokenService.encodeWithdraw(args.sodaAsset, args.hubAsset, args.vaultAssetAmount),
      Erc20Service.encodeApprove(args.hubAsset, args.assetManager, translatedAmount),
      EvmAssetManagerService.encodeTransfer(args.hubAsset, args.recipientOnSpoke, translatedAmount, args.assetManager),
    ];
    return encodeContractCalls(calls);
  }
}

