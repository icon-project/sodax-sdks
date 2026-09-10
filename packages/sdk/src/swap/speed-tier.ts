import { ChainKeys, type Address, type XToken } from '@sodax/types';

/**
 * Estimated settlement-speed bucket for a swap token pair.
 *
 * TODO: confirm the label set (slow / normal / fast) against the referenced spec doc, which
 * mentions "slow, normal, fast, etc." without pinning the exact enum.
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

/** Token pair to estimate a settlement-speed tier for. */
export type SwapSpeedTierParams = {
  /** Source spoke token. */
  srcToken: XToken;
  /** Destination spoke token. */
  dstToken: XToken;
};

/**
 * Hardcoded base estimates (seconds) for the rule-based speed tier.
 *
 * These are fixed rule constants — derived once from observed solver settlement
 * behavior, NOT measured at runtime. The optional future enhancement (analyzing public intents
 * data) would refine them; for the base feature they are intentionally hardcoded.
 *
 * TODO: confirm the exact numbers against the referenced spec doc.
 */
export const SPEED_TIER_SECONDS = {
  /** Either token maps to a money-market-reserve (sodaAsset) hub asset. */
  sodaAsset: 15,
  /** Anything else / default. */
  default: 35,
  /** Added once when either src or dst is an Ethereum asset. */
  ethereumPenalty: 10,
} as const;

/**
 * Provisional second→tier boundaries (inclusive upper bounds).
 *
 * TODO: confirm labels and boundaries — the possible totals under the current rules are
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
 * @param params `{ srcToken, dstToken }` spoke token pair to classify
 * @param isSodaAssetRelated predicate answering "is this hub asset a money-market-reserve
 *   (sodaAsset)?". In the service this is wired to `config.isMoneyMarketReserveHubAsset`; the
 *   predicate is injected so this function stays pure and unit-testable without a ConfigService.
 *
 * The fast 15s base applies when either token is sodaAsset-related; otherwise the base is 35s.
 */
export function estimateSwapSpeedTier(
  { srcToken, dstToken }: SwapSpeedTierParams,
  isSodaAssetRelated: (hubAsset: Address) => boolean,
): SwapSpeedTierResult {
  const eitherSodaAsset = isSodaAssetRelated(srcToken.hubAsset) || isSodaAssetRelated(dstToken.hubAsset);

  let estimatedSeconds = eitherSodaAsset ? SPEED_TIER_SECONDS.sodaAsset : SPEED_TIER_SECONDS.default;

  if (isEthereumToken(srcToken) || isEthereumToken(dstToken)) {
    estimatedSeconds += SPEED_TIER_SECONDS.ethereumPenalty;
  }

  return { tier: secondsToTier(estimatedSeconds), estimatedSeconds };
}
