import { describe, expect, it } from 'vitest';
import type { SpokeChainKey, XToken } from '@sodax/types';
import { ChainKeys, moneyMarketSupportedTokens } from '@sodax/types';
import { createPublicClient, http, type Address } from 'viem';
import { sonic } from 'viem/chains';
import { vaultTokenAbi } from '../shared/abis/vaultToken.abi.js';
import { Sodax } from '../index.js';

describe('e2e', () => {
  /**
   * E2e integration tests that hit live Sonic mainnet (public RPC + on-chain reads)
   * and assert static config in `@sodax/types` is in sync with on-chain state.
   * Runs in the non-blocking `e2e` CI job — see `.github/workflows/ci.yml`.
   */

  const sodax = new Sodax();

  const sonicPublicClient = createPublicClient({
    chain: sonic,
    transport: http(sonic.rpcUrls.default.http[0]),
  });

  type MmTokenSyncMismatch = {
    chain: SpokeChainKey;
    symbol: string;
    address: string;
    vault: string;
  };

  const toMmTokenSyncKey = (chain: SpokeChainKey, address: string): string =>
    `${chain}|${address.toLowerCase()}`;

  // Hub-side debt / bridge-only tokens that share MM vaults but are not money-market spoke assets.
  const mmTokenSyncExcludedFromTypes = new Set<string>([
    `${ChainKeys.SONIC_MAINNET}|0x94dc79ce9c515ba4ae4d195da8e6ab86c69bfc38`, // bnUSDd
    `${ChainKeys.BITCOIN_MAINNET}|897442:43`, // BUSD
  ]);

  // Listed in moneyMarketSupportedTokens but use migration / inactive vaults, not live pool reserves.
  const mmTokenSyncExcludedStaleInTypes = new Set<string>([
    `${ChainKeys.ICON_MAINNET}|cx88fd7df7ddff82f7cc735c871dc519838cb235bb`, // bnUSD (legacy)
    `${ChainKeys.SONIC_MAINNET}|0x9d4b663eb075d2a1c7b8eaefb9eccc0510388b51`, // IbnUSD
    `${ChainKeys.SONIC_MAINNET}|0x4b207114f9118deac56436e1ae3c45648783c7ac`, // sodaRBNT
    `${ChainKeys.NEAR_MAINNET}|bnusd.sodax.near`, // bnUSD (IbnUSD migration vault)
  ]);

  const isMmTokenSyncExcludedFromTypes = (chain: SpokeChainKey, address: string): boolean =>
    mmTokenSyncExcludedFromTypes.has(toMmTokenSyncKey(chain, address));

  const isMmTokenSyncExcludedStaleInTypes = (chain: SpokeChainKey, address: string): boolean =>
    mmTokenSyncExcludedStaleInTypes.has(toMmTokenSyncKey(chain, address));

  // Specific tokens skipped from the vault getAllTokenInfo hub-asset containment check.
  const mmTokenSyncExcludedFromVaultHubAssetCheck = new Set<string>([
    `${ChainKeys.NEAR_MAINNET}|bnusd.sodax.near`, // bnUSD — NEAR account id, not a hex address
    // Drift: sodaBTC vault does not list this hubAsset on-chain — track and remove once fixed upstream.
    `${ChainKeys.STACKS_MAINNET}|sm3vdxk3wzzsa84xxfkafaf15nnzx32ctsg82jfq4.sbtc-token`, // sBTC
  ]);

  const isMmTokenSyncExcludedFromVaultHubAssetCheck = (chain: SpokeChainKey, address: string): boolean =>
    mmTokenSyncExcludedFromVaultHubAssetCheck.has(toMmTokenSyncKey(chain, address));

  // date: 10.07.2025
  const solverCompatibleAssets: Record<SpokeChainKey, Address[]> = {
    [ChainKeys.AVALANCHE_MAINNET]: [
      '0xc9e4f0B6195F389D9d2b639f2878B7674eB9D8cD', // AVAX
      '0x41Fd5c169e014e2A657B9de3553f7a7b735Fe47A', // USDT
      '0x41abF4B1559FF709Ef8150079BcB26DB1Fffd117', // USDC
    ],
    [ChainKeys.BASE_MAINNET]: [
      '0x70178089842be7f8e4726b33f0d1569db8021faa', // ETH
      '0x55e0Ad45eB97493B3045eEE417fb6726CB85dfd4', // weETH
      '0x72E852545B024ddCbc5b70C1bCBDAA025164259C', // USDC
      '0x494aaEaEfDF5964d4Ed400174e8c5b98C00957aA', // wstETH
      '0x2803a23a3BA6b09e57D1c71deC0D9eFdBB00A27F', // cbBTC
    ],
    [ChainKeys.OPTIMISM_MAINNET]: [
      '0xad332860dd3b6f0e63f4f66e9457900917ac78cd', // ETH
      '0xb7C213CbD24967dE9838fa014668FDDB338f724B', // USDC
      '0x61e26f611090CdC6bc79A7Bf156b0fD10f1fC212', // wstETH
      '0xc168067d95109003805aC865ae556e8476DC69bc', // USDT
    ],
    [ChainKeys.ARBITRUM_MAINNET]: [
      '0xdcd9578b51ef55239b6e68629d822a8d97c95b86', // ETH
      '0xfB0ACB1b2720B620935F50a6dd3F7FEA52b2FCBe', // wBTC
      '0x08D5cf039De35627fD5C0f48B8AF4a1647a462E8', // weETH
      '0x2D5A7837D68b0c2CC4b14C2af2a1F0Ef420DDDc5', // wstETH
      '0x96Fc8540736f1598b7E235e6dE8814062b3b5d3B', // tBTC
      '0x3C0a80C6a1110fC80309382b3989eC626c135eE9', // USDT
      '0xdB7BdA65c3a1C51D64dC4444e418684677334109', // USDC
    ],
    [ChainKeys.POLYGON_MAINNET]: [
      '0x9ee17486571917837210824b0d4cadfe3b324d12', // POL
      '0xa36893ba308b332FDEbfa95916D1dF3a2e3CF8B3', // USDC
    ],
    [ChainKeys.BSC_MAINNET]: [
      '0x13b70564b1ec12876b20fab5d1bb630311312f4f', // BNB
      '0x57fC2aC5701e463ae261AdBd6C99FBeB48Ce5293', // ETHB
      '0xD8A24c71FEa5bB81c66C01e532dE7d9B11e13905', // BTCB
      '0x9D58508AD10d34048a11640735Ca5075bbA07b35', // USDC
    ],
    [ChainKeys.ICON_MAINNET]: [
      '0xb66cB7D841272AF6BaA8b8119007EdEE35d2C24F', // wICX
      '0x654dddf32a9a2ac53f5fb54bf1e93f66791f8047', // bnUSD
    ],
    [ChainKeys.INJECTIVE_MAINNET]: [
      '0xd375590b4955f6ea5623f799153f9b787a3bd319', // INJ
      '0x4Bc1211fAA06Fb50Ff61a70331F56167AE511057', // USDC
    ],
    [ChainKeys.STELLAR_MAINNET]: [
      '0x8ac68af223907fb1b893086601a3d99e00f2fa9d', // XLM
      '0x348007B53F25A9A857aB8eA81ec9E3CCBCf440f2', // USDC
    ],
    [ChainKeys.SOLANA_MAINNET]: [
      '0x0c09e69a4528945de6d16c7e469dea6996fdf636', // SOL
      '0xC3f020057510ffE10Ceb882e1B48238b43d78a5e', // USDC
    ],
    [ChainKeys.SUI_MAINNET]: [
      '0x4676b2a551b25c04e235553c1c81019337384673', // SUI
      '0x5635369c8a29A081d26C2e9e28012FCa548BA0Cb', // USDC
      '0x039666bd0cbc96a66c40e8541af465beaa81aa7e', // afSUI
      '0xb202c674c9a79b5681e981ba0daa782b3ceeebbe', // mSUI
      '0x67a26d11fce15e8b33ac97230d36cae1c52c35e7', // haSUI
      '0x025715bcda08db06c795cd5bf944e2081468d99a', // vSUI
      '0xac509404f3a3ca3f7766baf65be45a52b1cfccd7', // yapSUI
      '0x514569c788b096595672e0f68ec72387a22ac67b', // trevinSUI
    ],
    [ChainKeys.BITCOIN_MAINNET]: [],
    [ChainKeys.SONIC_MAINNET]: [],
    [ChainKeys.HYPEREVM_MAINNET]: [],
    [ChainKeys.LIGHTLINK_MAINNET]: [],
    [ChainKeys.NEAR_MAINNET]: [],
    [ChainKeys.ETHEREUM_MAINNET]: [],
    [ChainKeys.REDBELLY_MAINNET]: [],
    [ChainKeys.KAIA_MAINNET]: [],
    [ChainKeys.STACKS_MAINNET]: [],
  };

  it('Verify money market supported tokens as hub assets are contained in the Soda token vaults', async () => {
    const vaultGetAllTokenInfoMap = new Map<string, Address[]>();

    for (const spokeChain of sodax.config.getSupportedSpokeChains()) {
      // console.log('************************************************');
      const supportedTokens: readonly XToken[] = Object.values(
        sodax.config.getSupportedMoneyMarketTokensByChainId(spokeChain),
      );

      for (const token of supportedTokens) {
        if (isMmTokenSyncExcludedFromVaultHubAssetCheck(spokeChain, token.address)) {
          continue;
        }

        // console.log('--------------------------------');
        // console.log(`${spokeChain} ${token.symbol} ${token.address}`);

        if (!token.hubAsset) {
          throw new Error(`Hub asset not found for token ${token.address} on chain ${spokeChain}`);
        }

        const vaultAddress = token.vault;

        if (!vaultGetAllTokenInfoMap.has(vaultAddress)) {
          const [assets] = await sonicPublicClient.readContract({
            address: vaultAddress,
            abi: vaultTokenAbi,
            functionName: 'getAllTokenInfo',
            args: [],
          });

          vaultGetAllTokenInfoMap.set(
            vaultAddress,
            assets.map(asset => asset.toLowerCase() as Address),
          );
        }

        const vaultAssets = vaultGetAllTokenInfoMap.get(vaultAddress);

        if (!vaultAssets) {
          throw new Error(`Vault assets not found for token ${vaultAddress} on chain ${spokeChain}`);
        }

        // console.log(`vaultAddress: ${vaultAddress}, assets:`, vaultAssets);
        // console.log(
        //   `${spokeChain} ${token.symbol} ${token.hubAsset} ${vaultAssets.includes(token.hubAsset.toLowerCase() as Address)}`,
        // );

        const hubAssetLower = token.hubAsset.toLowerCase();
        expect(
          vaultAssets.includes(hubAssetLower as Address) ||
            hubAssetLower === '0x0000000000000000000000000000000000000000' ||
            hubAssetLower === vaultAddress.toLowerCase(),
          `${spokeChain} ${token.symbol}: hub asset ${token.hubAsset} not found in vault ${vaultAddress}`,
        ).toBe(true);
      }
    }
  }, 100000);

  it('Verify solver-compatible assets resolve to original spoke addresses', async () => {
    for (const [spokeChain, assets] of Object.entries(solverCompatibleAssets)) {
      const supportedTokens = Object.values(
        sodax.config.spokeChainConfig[spokeChain as SpokeChainKey].supportedTokens,
      );
      for (const asset of assets) {
        const match = supportedTokens.find(t => t.hubAsset.toLowerCase() === asset.toLowerCase());
        expect(
          match,
          `${spokeChain}: hub asset ${asset} not found in spoke supportedTokens`,
        ).toBeDefined();
      }
    }
  });

  const getChainKeysConstantName = (spokeChain: SpokeChainKey): string => {
    const chainKeyEntry = Object.entries(ChainKeys).find(([, chainKey]) => chainKey === spokeChain);
    return chainKeyEntry?.[0] ?? spokeChain;
  };

  const findSupportedTokenKey = (spokeChain: SpokeChainKey, address: string): string | undefined => {
    for (const [tokenKey, token] of Object.entries(sodax.config.spokeChainConfig[spokeChain].supportedTokens)) {
      if (token.address.toLowerCase() === address.toLowerCase()) {
        return tokenKey;
      }
    }

    return undefined;
  };

  const formatSupportedTokenAccessor = (tokenKey: string): string =>
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tokenKey)
      ? `.supportedTokens.${tokenKey}`
      : `.supportedTokens['${tokenKey}']`;

  const formatMoneyMarketSupportedTokenEntry = (spokeChain: SpokeChainKey, tokenKey: string): string =>
    `spokeChainConfig[ChainKeys.${getChainKeysConstantName(spokeChain)}]${formatSupportedTokenAccessor(tokenKey)},`;

  const logMissingMoneyMarketSupportedTokenHints = (missing: MmTokenSyncMismatch[]): void => {
    if (missing.length === 0) {
      return;
    }

    console.log(
      '\nAdd the following entries to packages/types/src/moneyMarket/moneyMarket.ts → moneyMarketSupportedTokens:\n',
    );

    for (const mismatch of missing) {
      const chainConstant = getChainKeysConstantName(mismatch.chain);
      const tokenKey = findSupportedTokenKey(mismatch.chain, mismatch.address);

      console.log('------------------------------------------------');
      console.log(`Chain: ${mismatch.chain} (ChainKeys.${chainConstant})`);
      console.log(`Token: ${mismatch.symbol} (${mismatch.address})`);
      console.log(`Vault: ${mismatch.vault} (present in on-chain reserves)`);
      console.log(`Add under [ChainKeys.${chainConstant}]:`);

      if (tokenKey) {
        console.log(`  ${formatMoneyMarketSupportedTokenEntry(mismatch.chain, tokenKey)}`);
      } else {
        console.log('  // Could not resolve spokeChainConfig key — add manually using the address above');
      }
    }

    console.log('------------------------------------------------\n');
  };

  const formatMmTokenSyncMismatches = (label: string, mismatches: MmTokenSyncMismatch[]): string => {
    if (mismatches.length === 0) {
      return label;
    }

    const details = mismatches
      .map(m => `${m.chain} ${m.symbol} (${m.address}, vault=${m.vault})`)
      .join(' | ');

    return `${label}: ${details}`;
  };

  it('Verify moneyMarketSupportedTokens is synced with on-chain reserves', async () => {
    const reservesSet = new Set(
      (await sodax.moneyMarket.data.getReservesList()).map(address => address.toLowerCase()),
    );

    const missingFromTypes: MmTokenSyncMismatch[] = [];
    const staleInTypes: MmTokenSyncMismatch[] = [];

    for (const spokeChain of sodax.config.getSupportedSpokeChains()) {
      const mmAddresses = new Set(
        moneyMarketSupportedTokens[spokeChain].map(token => token.address.toLowerCase()),
      );

      for (const token of Object.values(sodax.config.spokeChainConfig[spokeChain].supportedTokens)) {
        if (!reservesSet.has(token.vault.toLowerCase())) {
          continue;
        }

        if (!mmAddresses.has(token.address.toLowerCase())) {
          if (isMmTokenSyncExcludedFromTypes(spokeChain, token.address)) {
            continue;
          }

          missingFromTypes.push({
            chain: spokeChain,
            symbol: token.symbol,
            address: token.address,
            vault: token.vault,
          });
        }
      }
    }

    for (const [spokeChain, mmTokens] of Object.entries(moneyMarketSupportedTokens) as [
      SpokeChainKey,
      readonly XToken[],
    ][]) {
      for (const token of mmTokens) {
        if (!reservesSet.has(token.vault.toLowerCase())) {
          if (isMmTokenSyncExcludedStaleInTypes(spokeChain, token.address)) {
            continue;
          }

          staleInTypes.push({
            chain: spokeChain,
            symbol: token.symbol,
            address: token.address,
            vault: token.vault,
          });
        }
      }
    }

    logMissingMoneyMarketSupportedTokenHints(missingFromTypes);

    expect(
      missingFromTypes,
      formatMmTokenSyncMismatches('reserve-backed spoke tokens missing from moneyMarketSupportedTokens', missingFromTypes),
    ).toEqual([]);
    expect(
      staleInTypes,
      formatMmTokenSyncMismatches('moneyMarketSupportedTokens entries with vault not in on-chain reserves', staleInTypes),
    ).toEqual([]);
  }, 100_000);
});
