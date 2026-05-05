import type { Hex } from 'viem';
import {
  encodeContractCalls,
  Erc20Service,
  EvmAssetManagerService,
  type HubProvider,
  EvmVaultTokenService,
} from '../shared/index.js';
import invariant from 'tiny-invariant';
import type { EvmContractCall, SpokeChainKey, SpokeExecActionParams } from '@sodax/types';
import type { ConfigService } from '../shared/config/ConfigService.js';

export type UnifiedBnUSDMigrateAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  UnifiedBnUSDMigrateParams<K>
> & { unchecked?: boolean };

export type UnifiedBnUSDMigrateParams<K extends SpokeChainKey> = {
  srcAddress: string;
  srcChainKey: K; // The source chain ID where bnUSD (legacy or new) token exists
  srcbnUSD: string; // The spoke address of the bnUSD source token to migrate
  dstChainKey: SpokeChainKey; // The destination chain ID for the migration
  dstbnUSD: string; // The spoke address of the bnUSD destination token to receive
  amount: bigint; // The amount of bnUSD to migrate
  dstAddress: string; // The spoke address that will receive the migrated new bnUSD tokens
};

type FormattedBnUSDMigrateParams = {
  srcChainKey: SpokeChainKey; // The source chain ID where the legacy bnUSD token exists
  legacybnUSD: string; // The spoke address of the legacy bnUSD token to migrate
  newbnUSD: string; // The spoke address of the new bnUSD token to receive
  amount: bigint; // The amount of legacy bnUSD to migrate
  dstAddress: Hex; // The encoded spoke address (translated to hub chain) that will receive the migrated new bnUSD tokens
  dstChainKey: SpokeChainKey; // The destination chain ID for the migration
};

export type BnUSDRevertMigrationParams = {
  srcChainKey: SpokeChainKey; // The source chain key where the new bnUSD token exists
  legacybnUSD: string; // The ICON address of the legacy bnUSD token to receive
  newbnUSD: string; // The ICON address of the new bnUSD token to migrate from
  amount: bigint; // The amount of new bnUSD tokens to migrate back
  dstAddress: Hex; // The spoke chain address that will receive the migrated legacy bnUSD tokens
  dstChainKey: SpokeChainKey; // The destination chain key for the migration
};

export type BnUSDMigrationServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
};

/**
 * Low-level service for encoding bnUSD migration calldata executed on the hub chain (Sonic).
 *
 * This service is used internally by `MigrationService` and should not be called directly.
 * It encodes the hub-side contract call sequences required to transform tokens across the two
 * bnUSD "generations":
 * - Legacy bnUSD (ICON, Sui, Stellar) → new bnUSD (EVM spokes) via `migrateData`
 * - New bnUSD (EVM spokes) → legacy bnUSD (ICON, Sui, Stellar) via `revertMigrationData`
 *
 * Both directions route through the shared `bnUSDVault` on the hub using ERC-4626 deposit/
 * withdraw mechanics and decimal translation handled by `EvmVaultTokenService`.
 */
export class BnUSDMigrationService {
  private readonly hubProvider: HubProvider;
  private readonly config: ConfigService;

  constructor({ hubProvider, config }: BnUSDMigrationServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.config = config;
  }

  /**
   * Encodes the hub execution calldata for a legacy bnUSD → new bnUSD migration.
   *
   * Produces a batched contract call sequence:
   * 1. Approve the legacy bnUSD hub-asset to its corresponding spoke vault.
   * 2. Deposit the hub-asset into the spoke vault to receive vault-share tokens.
   * 3. Approve the vault-share tokens to the shared `bnUSDVault`.
   * 4. Deposit the vault-share tokens into `bnUSDVault`.
   * 5a. If `newbnUSD` equals `bnUSDVault` (destination is the hub vault itself), transfer
   *     vault-share tokens directly to `dstAddress`.
   * 5b. Otherwise, withdraw from `bnUSDVault` into the destination spoke's hub-asset and
   *     transfer it to `dstAddress` via the asset manager.
   *
   * Decimal translation between legacy and new token precisions is applied automatically.
   *
   * @param params - Internal migration parameters: source chain key, legacy and new bnUSD
   *   addresses, amount, ABI-encoded destination address, and destination chain key.
   * @returns ABI-encoded batch of contract calls ready for hub execution.
   * @throws If the hub asset configuration for the legacy or new bnUSD token is not found.
   */
  public migrateData(params: FormattedBnUSDMigrateParams): Hex {
    const calls: EvmContractCall[] = [];
    const assetConfig = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, params.legacybnUSD);
    invariant(assetConfig, `hub asset not found for legacy bnUSD token: ${params.legacybnUSD}`);

    const bnUSDVault = this.config.moneyMarket.bnUSDVault;

    // Wrap legacy bnUSD into vault tokens
    calls.push(Erc20Service.encodeApprove(assetConfig.hubAsset, assetConfig.vault, params.amount));
    calls.push(EvmVaultTokenService.encodeDeposit(assetConfig.vault, assetConfig.hubAsset, params.amount));

    // Migrate to new bnUSD vault
    const translatedAmount = EvmVaultTokenService.translateIncomingDecimals(assetConfig.decimals, params.amount);
    calls.push(Erc20Service.encodeApprove(assetConfig.vault, bnUSDVault, translatedAmount));
    calls.push(EvmVaultTokenService.encodeDeposit(bnUSDVault, assetConfig.vault, translatedAmount));

    // check if bnUSD is getting migrated to hub chain bnUSD vault
    if (params.newbnUSD.toLowerCase() === bnUSDVault.toLowerCase()) {
      calls.push(Erc20Service.encodeTransfer(bnUSDVault, params.dstAddress, translatedAmount));
      return encodeContractCalls(calls);
    }

    // Withdraw to new bnUSD
    const dstAssetConfig = this.config.getSpokeTokenFromOriginalAssetAddress(params.dstChainKey, params.newbnUSD);
    invariant(dstAssetConfig, `hub asset not found for new bnUSD token: ${params.newbnUSD}`);

    calls.push(EvmVaultTokenService.encodeWithdraw(bnUSDVault, dstAssetConfig.hubAsset, translatedAmount));
    const translatedAmountOut = EvmVaultTokenService.translateOutgoingDecimals(
      dstAssetConfig.decimals,
      translatedAmount,
    );
    calls.push(
      EvmAssetManagerService.encodeTransfer(
        dstAssetConfig.hubAsset,
        params.dstAddress,
        translatedAmountOut,
        this.hubProvider.chainConfig.addresses.assetManager,
      ),
    );

    return encodeContractCalls(calls);
  }

  /**
   * Encodes the hub execution calldata for a new bnUSD → legacy bnUSD reverse migration.
   *
   * Produces a batched contract call sequence:
   * 1. If `newbnUSD` is not the hub vault itself: approve the new bnUSD hub-asset to
   *    `bnUSDVault` and deposit it to receive vault-share tokens.
   * 2. Withdraw from `bnUSDVault` into the legacy bnUSD's spoke vault.
   * 3. Withdraw from the spoke vault into the legacy bnUSD hub-asset.
   * 4. Transfer the legacy bnUSD hub-asset to `dstAddress` via the asset manager.
   *
   * Decimal translation is applied when moving across vault boundaries.
   *
   * @param params - Internal revert parameters: source chain key, new bnUSD and legacy bnUSD
   *   addresses, amount, ABI-encoded destination address, and destination chain key.
   * @returns ABI-encoded batch of contract calls ready for hub execution.
   * @throws If the hub asset configuration for the new or legacy bnUSD token is not found.
   */
  public revertMigrationData(params: BnUSDRevertMigrationParams): Hex {
    const calls: EvmContractCall[] = [];
    const bnUSDVault = this.config.moneyMarket.bnUSDVault;

    // Wrap new bnUSD into vault tokens
    let decimals = 18;
    if (params.newbnUSD.toLowerCase() !== bnUSDVault.toLowerCase()) {
      const assetConfig = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, params.newbnUSD);
      invariant(assetConfig, `hub asset not found for new bnUSD token: ${params.newbnUSD}`);
      decimals = assetConfig.decimals;
      calls.push(Erc20Service.encodeApprove(assetConfig.hubAsset, bnUSDVault, params.amount));
      calls.push(EvmVaultTokenService.encodeDeposit(bnUSDVault, assetConfig.hubAsset, params.amount));
    }

    const translatedAmount = EvmVaultTokenService.translateIncomingDecimals(decimals, params.amount);

    // Migrate to legacy bnUSD vault'
    const dstAssetConfig = this.config.getSpokeTokenFromOriginalAssetAddress(params.dstChainKey, params.legacybnUSD);
    invariant(dstAssetConfig, `hub asset not found for new bnUSD token: ${params.legacybnUSD}`);

    calls.push(EvmVaultTokenService.encodeWithdraw(bnUSDVault, dstAssetConfig.vault, translatedAmount));
    calls.push(EvmVaultTokenService.encodeWithdraw(dstAssetConfig.vault, dstAssetConfig.hubAsset, translatedAmount));

    const translatedAmountOut = EvmVaultTokenService.translateOutgoingDecimals(
      dstAssetConfig.decimals,
      translatedAmount,
    );

    calls.push(
      EvmAssetManagerService.encodeTransfer(
        dstAssetConfig.hubAsset,
        params.dstAddress,
        translatedAmountOut,
        this.hubProvider.chainConfig.addresses.assetManager,
      ),
    );

    return encodeContractCalls(calls);
  }
}
