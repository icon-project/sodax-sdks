import {
  type ChainKey,
  ChainKeys,
  EVM_CHAIN_KEYS,
  type EvmChainKey,
  type XToken,
  baseChainInfo,
  getSupportedSolverTokens,
  spokeChainConfig,
} from '@sodax/dapp-kit';
import type { Flow } from './flows';

/** An EVM chain that `spokeChainConfig` covers — narrow enough to index the config object safely. */
export type PlaygroundChainKey = EvmChainKey & keyof typeof spokeChainConfig;

function evmChainsWhere(hasTokens: (key: PlaygroundChainKey) => boolean): readonly PlaygroundChainKey[] {
  return EVM_CHAIN_KEYS.filter((key): key is PlaygroundChainKey => key in spokeChainConfig && hasTokens(key));
}

/**
 * The chains this app offers in its pickers, derived from `@sodax/types` rather than listed here:
 * EVM (the only wallet adapter mounted) and non-empty on the solver's swap-token list.
 */
export const swappableChains = evmChainsWhere(key => getSupportedSolverTokens(key).length > 0);

/** Bridging moves one asset between chains, so the gate is the chain's own list, not the solver's. */
export const bridgeableChains = evmChainsWhere(key => spokeTokens(key).length > 0);

/** Every token the chain's spoke supports — the bridge source list, wider than the solver's. */
export function spokeTokens(key: PlaygroundChainKey): XToken[] {
  return Object.values(spokeChainConfig[key].supportedTokens);
}

export function chainsFor(flow: Flow): readonly PlaygroundChainKey[] {
  return flow === 'bridge' ? bridgeableChains : swappableChains;
}

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

function firstAvailable(
  chains: readonly PlaygroundChainKey[],
  preferred: PlaygroundChainKey,
  fallbackIndex: number,
): PlaygroundChainKey {
  return chains.includes(preferred) ? preferred : chains[fallbackIndex];
}

export function defaultSrcChain(flow: Flow): PlaygroundChainKey {
  return firstAvailable(chainsFor(flow), ChainKeys.BASE_MAINNET, 0);
}

export function defaultDstChain(flow: Flow): PlaygroundChainKey {
  return firstAvailable(chainsFor(flow), ChainKeys.ARBITRUM_MAINNET, 1);
}
