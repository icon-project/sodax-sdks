import { type ChainKey, ChainKeys, type XToken, baseChainInfo } from '@sodax/dapp-kit';

/**
 * A URL or an API response is a string until it matches a key `baseChainInfo` can name and badge.
 * `Object.hasOwn`, not `in`: `in` walks the prototype, so `?srcChain=toString` would pass and then
 * index a function that has no `name` or `logo` to render.
 */
export function isChainKey(value: string): value is ChainKey {
  return Object.hasOwn(baseChainInfo, value);
}

/** A token together with the key of the chain it lives on, so one pick sets both. */
export type TokenChoice<K extends ChainKey = ChainKey> = { chain: K; token: XToken };

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
