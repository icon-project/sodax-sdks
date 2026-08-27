import {
  type ChainKey,
  ChainKeys,
  EVM_CHAIN_KEYS,
  type EvmChainKey,
  baseChainInfo,
  getSupportedSolverTokens,
  spokeChainConfig,
} from '@sodax/dapp-kit';

/** An EVM chain that `spokeChainConfig` covers — narrow enough to index the config object safely. */
export type PlaygroundChainKey = EvmChainKey & keyof typeof spokeChainConfig;

/**
 * The chains this app offers in its pickers, derived from `@sodax/types` rather than listed here:
 * EVM (the only wallet adapter mounted) and non-empty on the solver's swap-token list.
 */
export const swappableChains: readonly PlaygroundChainKey[] = EVM_CHAIN_KEYS.filter(
  (key): key is PlaygroundChainKey => key in spokeChainConfig && getSupportedSolverTokens(key).length > 0,
);

export function chainName(key: ChainKey): string {
  return baseChainInfo[key].name;
}

export function txExplorerUrl(key: ChainKey, txHash: string): string {
  return `${baseChainInfo[key].explorer.txUrl}${txHash}`;
}

/** Renders a chain key as the `ChainKeys.X` expression a reader should paste, not its raw value. */
export function chainKeyExpression(key: ChainKey): string {
  const name = Object.entries(ChainKeys).find(([, value]) => value === key)?.[0];
  return name ? `ChainKeys.${name}` : JSON.stringify(key);
}

function firstAvailable(preferred: PlaygroundChainKey, fallbackIndex: number): PlaygroundChainKey {
  return swappableChains.includes(preferred) ? preferred : swappableChains[fallbackIndex];
}

export const DEFAULT_SRC_CHAIN = firstAvailable(ChainKeys.BASE_MAINNET, 0);
export const DEFAULT_DST_CHAIN = firstAvailable(ChainKeys.ARBITRUM_MAINNET, 1);
