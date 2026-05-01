import { erc20Abi, isAddress, type Address } from 'viem';
import type { GetAddressType, Result, SpokeChainKey, SpokeExecActionParams, TxReturnType } from '@sodax/types';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { HubProvider } from '../shared/types/types.js';
import type { SpokeService } from '../shared/services/spoke/SpokeService.js';
import { EvmAssetManagerService } from '../shared/services/hub/EvmAssetManagerService.js';
import type { SendMessageParams } from '../shared/types/spoke-types.js';
import { encodeAddress } from '../shared/index.js';

export type HubAssetBalance = {
  /** The original token address on the spoke chain (key for the SDK's spoke→hub asset map). */
  spokeTokenAddress: Address;
  /** The wrapped asset address on the hub chain. */
  hubAssetAddress: Address;
  symbol: string;
  name: string;
  decimal: number;
  /** Raw `balanceOf` of the hub-side asset for the user's hub wallet. */
  balance: bigint;
};

export type FetchHubAssetBalancesParams = {
  /** The spoke chain whose tokens we are reconciling on the hub side. */
  chainKey: SpokeChainKey;
  /** The user's address on the spoke chain. The service derives the hub wallet abstraction internally. */
  srcAddress: string;
};

export type WithdrawHubAssetParams<K extends SpokeChainKey> = {
  /** The spoke chain to withdraw the asset back to. The user's wallet is on this chain. */
  srcChainKey: K;
  /** The user's address on the spoke chain. The service derives the hub wallet abstraction internally. */
  srcAddress: GetAddressType<K>;
  /** The original spoke-side token address (drives the SDK's hub-asset lookup). */
  token: Address;
  /** Amount to withdraw, denominated in the hub-side asset. */
  amount: bigint;
};

export type WithdrawHubAssetAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  WithdrawHubAssetParams<K>
>;

export type RecoveryServiceConstructorParams = {
  config: ConfigService;
  hubProvider: HubProvider;
  spoke: SpokeService;
};

/**
 * RecoveryService lets a user reconcile and withdraw assets that ended up stuck in their hub
 * wallet (e.g. due to a relay or downstream failure) back to a connected spoke chain wallet.
 * @namespace SodaxFeatures
 */
export class RecoveryService {
  private readonly hubProvider: HubProvider;
  private readonly config: ConfigService;
  private readonly spoke: SpokeService;

  public constructor({ config, hubProvider, spoke }: RecoveryServiceConstructorParams) {
    this.config = config;
    this.hubProvider = hubProvider;
    this.spoke = spoke;
  }

  /**
   * Fetches the user's hub-side `balanceOf` for every supported token on the given spoke chain.
   * Iterates `config.spokeChainConfig[chainKey].supportedTokens`, skips placeholder hubAssets
   * (e.g. `'0x'` for not-yet-deployed tokens), derives the user's hub wallet abstraction from
   * `srcAddress` + `chainKey`, multicalls `balanceOf(hubWallet)` on the hub chain, and returns
   * the entries with non-zero balance. Per-asset failures are isolated via `allowFailure: true`.
   */
  public async fetchHubAssetBalances({
    chainKey,
    srcAddress,
  }: FetchHubAssetBalancesParams): Promise<Result<HubAssetBalance[]>> {
    try {
      const chainConfig = this.config.spokeChainConfig[chainKey];
      if (!chainConfig) {
        return { ok: false, error: new Error(`Unknown spoke chain key: ${chainKey}`) };
      }

      const entries = Object.values(chainConfig.supportedTokens).filter(token => isAddress(token.hubAsset));

      if (entries.length === 0) {
        return { ok: true, value: [] };
      }

      const hubWallet = await this.hubProvider.getUserHubWalletAddress(srcAddress, chainKey);

      const balanceResults = await this.hubProvider.publicClient.multicall({
        contracts: entries.map(token => ({
          address: token.hubAsset as Address,
          abi: erc20Abi,
          functionName: 'balanceOf' as const,
          args: [hubWallet],
        })),
        allowFailure: true,
      });

      const balances: HubAssetBalance[] = [];
      entries.forEach((token, index) => {
        const result = balanceResults[index];
        if (!result || result.status !== 'success') return;
        const balance = result.result as bigint;
        if (balance <= 0n) return;
        balances.push({
          spokeTokenAddress: token.address.toLowerCase() as Address,
          hubAssetAddress: (token.hubAsset as string).toLowerCase() as Address,
          symbol: token.symbol,
          name: token.name,
          decimal: token.decimals,
          balance,
        });
      });

      return { ok: true, value: balances };
    } catch (error) {
      return { ok: false, error: new Error('FETCH_HUB_ASSET_BALANCES_FAILED', { cause: error }) };
    }
  }

  /**
   * Withdraws a stuck hub-side asset back to the user's spoke chain wallet. Derives the user's
   * hub wallet abstraction from `srcAddress` + `srcChainKey`, builds the encoded transfer
   * payload via `EvmAssetManagerService.withdrawAssetData`, then relays it through the spoke
   * chain via `SpokeService.sendMessage` so the hub wallet executes the call.
   */
  public async withdrawHubAsset<K extends SpokeChainKey, Raw extends boolean>(
    _params: WithdrawHubAssetAction<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>>> {
    const { params } = _params;
    try {
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
      const payload = EvmAssetManagerService.withdrawAssetData(
        {
          token: params.token,
          to: encodeAddress(params.srcChainKey, params.srcAddress),
          amount: params.amount,
        },
        this.hubProvider,
        params.srcChainKey,
      );

      const coreParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: params.srcAddress,
        dstChainKey: this.hubProvider.chainConfig.chain.key,
        dstAddress: hubWallet,
        payload,
      };

      const sendMessageParams = _params.raw
        ? ({ ...coreParams, raw: true } satisfies SendMessageParams<K, true>)
        : ({ ...coreParams, raw: false, walletProvider: _params.walletProvider } satisfies SendMessageParams<K, false>);

      const txResult = await this.spoke.sendMessage(sendMessageParams);
      if (!txResult.ok) return txResult;

      return {
        ok: true,
        value: txResult.value satisfies TxReturnType<K, boolean> as TxReturnType<K, Raw>,
      };
    } catch (error) {
      return { ok: false, error: new Error('WITHDRAW_HUB_ASSET_FAILED', { cause: error }) };
    }
  }
}
