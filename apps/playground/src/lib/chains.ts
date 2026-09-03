import {
  type ChainKey,
  ChainKeys,
  EVM_CHAIN_KEYS,
  type EvmChainKey,
  type XToken,
  baseChainInfo,
  spokeChainConfig,
} from '@sodax/dapp-kit';

/** An EVM chain that `spokeChainConfig` covers — narrow enough to index the config object safely. */
export type PlaygroundChainKey = EvmChainKey & keyof typeof spokeChainConfig;

/**
 * A URL or an API response is a string until it matches a key `baseChainInfo` can name and badge.
 * `Object.hasOwn`, not `in`: `in` walks the prototype, so `?srcChain=toString` would pass and then
 * index a function that has no `name` or `logo` to render.
 */
export function isChainKey(value: string): value is ChainKey {
  return Object.hasOwn(baseChainInfo, value);
}

/**
 * The parked bridge flow's chain list: bridging moves one asset between chains, so the gate is the
 * chain's own supported-token list rather than the solver's. Still EVM-only — the bridge signs, and
 * EVM is the one family this app ever mounted a wallet adapter for.
 */
export const bridgeableChains: readonly PlaygroundChainKey[] = EVM_CHAIN_KEYS.filter(
  (key): key is PlaygroundChainKey => key in spokeChainConfig && spokeTokens(key).length > 0,
);

/** Every token the chain's spoke supports — the bridge's source list. */
export function spokeTokens(key: PlaygroundChainKey): XToken[] {
  return Object.values(spokeChainConfig[key].supportedTokens);
}

/**
 * A token together with the key of the chain it lives on, so one pick sets both. Generic because
 * the swap widget's chains come from the API as the wide `ChainKey` while the parked bridge keeps
 * its EVM-narrowed list, and the pickers are shared.
 */
export type TokenChoice<K extends ChainKey = ChainKey> = { chain: K; token: XToken };

/** Every token the parked bridge can start from, paired with the chain it came from. */
export function bridgeTokenChoices(): readonly TokenChoice<PlaygroundChainKey>[] {
  return bridgeableChains.flatMap(chain => spokeTokens(chain).map(token => ({ chain, token })));
}

export function chainLogo(key: ChainKey): string {
  return baseChainInfo[key].logo;
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

/** Resolves a URL chain key against the bridge's derived list, which is the allowlist. */
export function bridgeChainOr(value: string | undefined, fallback: PlaygroundChainKey): PlaygroundChainKey {
  return bridgeableChains.find(key => key === value) ?? fallback;
}

export function defaultBridgeSrcChain(): PlaygroundChainKey {
  return firstAvailable(bridgeableChains, ChainKeys.BASE_MAINNET, 0);
}

export function defaultBridgeDstChain(): PlaygroundChainKey {
  return firstAvailable(bridgeableChains, ChainKeys.ARBITRUM_MAINNET, 1);
}
