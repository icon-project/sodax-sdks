// Dumps the SDK swap-supported token lists as JSON for the sync-swap-tokens-docs.sh script.
//
// The swap lists in packages/types reference token objects indirectly
// (`spokeChainConfig[ChainKeys.X].supportedTokens.Y`), so they cannot be parsed
// reliably from source text — we import the resolved values instead and print them.
//
// Run via tsx (no build step required), e.g. `npx tsx scripts/lib/dump-swap-tokens.mts`.
//
// Output shape:
// {
//   "relayChainIdMap": { "<chainKey>": "<oracle chainId>" },
//   "chains":      { "<chainKey>": { name, type, addressUrl } },
//   "production":  { "<chainKey>": [ { symbol, address, chainKey, hubAsset }, ... ] },
//   "stagingOnly": { "<chainKey>": [ ... ] }   // staging-only extras (staging = production + these)
// }
import { swapSupportedTokens, stagingSwapSupportedTokens } from '../../packages/types/src/swap/swap.js';
import { RelayChainIdMap, baseChainInfo } from '../../packages/types/src/chains/chains.js';
import type { XToken } from '../../packages/types/src/chains/tokens.js';

const pick = (tokens: readonly XToken[]) =>
  tokens.map(t => ({ symbol: t.symbol, address: t.address, chainKey: t.chainKey, hubAsset: t.hubAsset }));

const mapLists = (lists: Record<string, readonly XToken[]>) =>
  Object.fromEntries(Object.entries(lists).map(([chainKey, tokens]) => [chainKey, pick(tokens)]));

const chains = Object.fromEntries(
  Object.entries(baseChainInfo).map(([chainKey, info]) => [
    chainKey,
    { name: info.name, type: info.type, addressUrl: info.explorer?.addressUrl ?? '' },
  ]),
);

const out = {
  relayChainIdMap: Object.fromEntries(Object.entries(RelayChainIdMap).map(([k, v]) => [k, String(v)])),
  chains,
  production: mapLists(swapSupportedTokens),
  stagingOnly: mapLists(stagingSwapSupportedTokens),
};

process.stdout.write(JSON.stringify(out));
