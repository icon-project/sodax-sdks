import { ChainKeys, type Address, type XToken } from '@sodax/types';

/**
 * Estimated settlement-speed bucket for a swap token pair.
 *
 * TODO(#192): confirm the label set (slow / normal / fast) against the referenced spec doc —
 * the issue mentions "slow, normal, fast, etc." without pinning the exact enum.
 */
export type SwapSpeedTier = 'fast' | 'normal' | 'slow';

/**
 * Rule-based estimate of how fast a src→dst swap settles, plus the tier bucket it falls into.
 * `estimatedSeconds` is the source of truth; `tier` is derived from it.
 */
export type SwapSpeedTierResult = {
  tier: SwapSpeedTier;
  estimatedSeconds: number;
};

/**
 * Hardcoded base estimates (seconds) for the rule-based speed tier.
 *
 * These are fixed rule constants from #192 — derived once from observed solver settlement
 * behavior, NOT measured at runtime. The optional future enhancement (analyzing public intents
 * data) would refine them; for the base feature they are intentionally hardcoded.
 *
 * TODO(#192): confirm the exact numbers against the referenced spec doc.
 */
export const SPEED_TIER_SECONDS = {
  /** Both tokens map to a money-market-reserve (sodaAsset) hub asset — hub-to-hub fast path. */
  sodaAsset: 15,
  /** Anything else / default. */
  default: 35,
  /** Added once when either src or dst is an Ethereum asset. */
  ethereumPenalty: 10,
} as const;

/**
 * Provisional second→tier boundaries (inclusive upper bounds).
 *
 * TODO(#192): confirm labels and boundaries — the possible totals under the current rules are
 * 15 / 25 / 35 / 45, so these thresholds bucket them as fast(15) · normal(25) · slow(35, 45).
 */
export const SPEED_TIER_THRESHOLDS = {
  fast: 20,
  normal: 30,
} as const;

const isEthereumToken = (token: XToken): boolean => token.chainKey === ChainKeys.ETHEREUM_MAINNET;

const secondsToTier = (seconds: number): SwapSpeedTier => {
  if (seconds <= SPEED_TIER_THRESHOLDS.fast) return 'fast';
  if (seconds <= SPEED_TIER_THRESHOLDS.normal) return 'normal';
  return 'slow';
};

/**
 * Pure, offline, rule-based estimate of how fast a src→dst swap will settle. Performs no
 * network or on-chain call — it classifies the pair from SDK config alone.
 *
 * @param srcToken source spoke `XToken`
 * @param dstToken destination spoke `XToken`
 * @param isSodaAssetRelated predicate answering "is this hub asset a money-market-reserve
 *   (sodaAsset)?". In the service this is wired to `config.isMoneyMarketReserveHubAsset`; the
 *   predicate is injected so this function stays pure and unit-testable without a ConfigService.
 *
 * ASSUMPTION (#192 — needs confirmation): the fast 15s base applies only when BOTH tokens are
 * sodaAsset-related (the hub-to-hub fast path). If either side is "other", the base is 35s. The
 * issue wording ("Any token related to a sodaAsset → 15 sec | Any other → 35 sec") is ambiguous
 * about either-vs-both; flip `&&` to `||` here if the intended rule is "either".
 */
export function estimateSwapSpeedTier(
  srcToken: XToken,
  dstToken: XToken,
  isSodaAssetRelated: (hubAsset: Address) => boolean,
): SwapSpeedTierResult {
  const bothSodaAsset = isSodaAssetRelated(srcToken.hubAsset) && isSodaAssetRelated(dstToken.hubAsset);

  let estimatedSeconds = bothSodaAsset ? SPEED_TIER_SECONDS.sodaAsset : SPEED_TIER_SECONDS.default;

  if (isEthereumToken(srcToken) || isEthereumToken(dstToken)) {
    estimatedSeconds += SPEED_TIER_SECONDS.ethereumPenalty;
  }

  return { tier: secondsToTier(estimatedSeconds), estimatedSeconds };
}
