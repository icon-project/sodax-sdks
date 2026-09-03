import type { ChainKey } from '@sodax/dapp-kit';
import type { TokenChoice } from './chains';

/** One asset, and every chain that offers it. The picker's grid is one tile per group. */
export type AssetGroup<K extends ChainKey = ChainKey> = {
  symbol: string;
  choices: readonly TokenChoice<K>[];
};

/**
 * Chain plus symbol, never address: a `withdrawOnly` entry shares its on-chain address with the
 * active token it deprecates (`WBTC` / `WBTC.legacy`), so an address-keyed id addresses both rows
 * at once. Symbol is also what `pickToken` re-resolves by, so the id and the flow agree.
 */
export function tokenOptionId(chain: ChainKey, symbol: string): string {
  return `${chain}:${symbol}`;
}

/**
 * Groups tokens by symbol, widest reach first. The exchange sorts by held value; with no balances
 * here, chain count is the honest stand-in — it puts the assets SODAX carries furthest at the top,
 * which is the same set that sorts first there.
 */
export function assetGroups<K extends ChainKey>(choices: readonly TokenChoice<K>[]): AssetGroup<K>[] {
  const bySymbol = new Map<string, TokenChoice<K>[]>();

  for (const choice of choices) {
    const group = bySymbol.get(choice.token.symbol);
    if (group) group.push(choice);
    else bySymbol.set(choice.token.symbol, [choice]);
  }

  return [...bySymbol]
    .map(([symbol, group]) => ({ symbol, choices: group }))
    .sort((a, b) => b.choices.length - a.choices.length || a.symbol.localeCompare(b.symbol));
}

/** Case-insensitive symbol match, and — when a network is picked — only groups that reach it. */
export function filterGroups<K extends ChainKey>(
  groups: readonly AssetGroup<K>[],
  query: string,
  network: K | undefined,
): AssetGroup<K>[] {
  const needle = query.trim().toLowerCase();

  return groups.reduce<AssetGroup<K>[]>((kept, group) => {
    if (needle && !group.symbol.toLowerCase().includes(needle)) return kept;

    const choices = network ? group.choices.filter(choice => choice.chain === network) : group.choices;
    if (choices.length > 0) kept.push({ symbol: group.symbol, choices });
    return kept;
  }, []);
}
