/**
 * Sizing a leverage position's swap leg.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT OPTIONAL. A position's leverage is bought through the solver, and
 * the two legs do not trade at their oracle ratio. `LeverageHook` supplies whatever the solver
 * actually paid and only *then* borrows against it, so the pool's health check at fill time sees
 * `deposit + solver output`, never `deposit x leverage`. Size the leg from oracle prices and the
 * borrow reverts with Aave error `'36'` (COLLATERAL_CANNOT_COVER_NEW_BORROW) — the intent is accepted,
 * the solver fills, and the whole fill unwinds. That is not a hypothetical, it happened twice on
 * mainnet, and the two failures had different causes worth keeping apart:
 *
 *   - counting a debt-side deposit as collateral as well as handing it to the solver, which put an
 *     11.03x open at a projected 84% LTV;
 *   - pricing the solver's output at oracle parity, which put the same open at 90.9% when the real
 *     figure was 92.06% against a 91% cap.
 *
 * `side` addresses the first and `f` the second.
 *
 * So sizing is a two-phase thing, and both phases are here:
 *
 *   1. {@link sizeLeverageBorrow} — how much to borrow for a target leverage. Oracle-priced, because
 *      there is nothing else to go on yet. Quote THIS amount.
 *   2. {@link projectLeverageLeg} — given that quote, the slippage floor, what the position really
 *      looks like at that floor, and the highest leverage the quote actually supports.
 *
 * Everything in phase 2 is projected from the FLOOR rather than the quote, deliberately: the floor is
 * the worst fill the intent permits, so if the floor is safe every fill is. Projecting from the quote
 * leaves the slippage tolerance as unmodelled headroom, which is exactly the gap that failed.
 *
 * Prices are the pool oracle's, in its base currency; any consistent unit works since only ratios
 * matter. Rates and LTVs are fractions, not percentages.
 */

import { formatUnits } from 'viem';

/** Which asset the user is funding with. */
export type PositionSide = 'collateral' | 'debt';

export type LeverageLegRequest = {
  /**
   * `'collateral'` funds with the collateral asset, which is supplied. `'debt'` funds with the debt
   * asset, which is NOT supplied — it is handed to the solver as part of the intent's input, so the
   * only collateral the position ends up with is what the solver delivers. Counting the deposit on
   * both sides is what produced the 84%-vs-92.06% miss.
   */
  side: PositionSide;
  /** Deposit in its own token decimals — the collateral token or the debt token, per `side`. */
  deposit: bigint;
  depositDecimals: number;
  collateralPriceUsd: number;
  borrowPriceUsd: number;
  borrowDecimals: number;
  /** Target leverage as a multiple of equity. 1 means unlevered and borrows nothing. */
  leverage: number;
};

export type LeverageBorrowSizing = {
  /** Borrow-token amount the position should borrow. */
  borrowAmount: bigint;
  /**
   * What the solver receives as the intent's input: the borrowed amount, plus the user's own
   * contribution on a debt-side open, since the debt-side hook is paid both. Quote this.
   */
  intentInput: bigint;
  /** The deposit's value, priced with the token actually deposited. */
  depositUsd: number;
  /** Value being borrowed. */
  borrowUsd: number;
};

/**
 * Phase 1: the borrow for a target leverage, and the input to quote.
 *
 * ORACLE SIZING ONLY. It deliberately does not project the result, because at this point it cannot —
 * the collateral that lands is whatever the solver pays. Feed `intentInput` to a solver quote and
 * pass the result to {@link projectLeverageLeg}.
 */
export function sizeLeverageBorrow(request: LeverageLegRequest): LeverageBorrowSizing {
  const { side, deposit, depositDecimals, collateralPriceUsd, borrowPriceUsd, borrowDecimals, leverage } = request;
  const depositTokens = Number(formatUnits(deposit, depositDecimals));
  // Priced with what was actually deposited: using the collateral price on a debt-side open
  // overstated the deposit by the whole sUSDS/USSD spread.
  const depositUsd = depositTokens * (side === 'debt' ? borrowPriceUsd : collateralPriceUsd);

  /**
   * The token conversion runs in bigint; only the RATIO comes from floating point.
   *
   * Going through `Number` and `toFixed(decimals)` instead — the obvious way — turns a clean 2.14
   * into 2140000000000000124 wei: `1.07 x 2` is not exactly representable, and the decimal string
   * carries the error all the way down to sub-wei. Harmless in a display; this number is what gets
   * borrowed.
   *
   * `RATIO_SCALE` is 1e9 and not 1e18 deliberately — a double holds integers exactly only to about
   * 9e15, so scaling by 1e18 would reintroduce the error being avoided. Nine significant digits is
   * already finer than the oracle's own precision.
   *
   * Floored, never rounded up: borrowing a hair more than asked moves LTV the way that reverts.
   */
  const RATIO_SCALE = 1_000_000_000n;
  const ratio =
    borrowPriceUsd > 0 && depositTokens > 0
      ? (depositUsd * Math.max(leverage - 1, 0)) / borrowPriceUsd / depositTokens
      : 0;
  const borrowAmount =
    (deposit * BigInt(Math.floor(ratio * Number(RATIO_SCALE))) * 10n ** BigInt(borrowDecimals)) /
    (RATIO_SCALE * 10n ** BigInt(depositDecimals));

  return {
    borrowAmount,
    intentInput: side === 'debt' ? borrowAmount + deposit : borrowAmount,
    depositUsd,
    // Taken from the amount actually being borrowed, so the projection cannot disagree with the
    // transaction by the rounding above.
    borrowUsd: Number(formatUnits(borrowAmount, borrowDecimals)) * borrowPriceUsd,
  };
}

export type LeverageLegQuote = {
  /** What the solver quoted for `intentInput`, in the collateral reserve's decimals. */
  quotedCollateral: bigint;
  collateralDecimals: number;
};

export type ReserveRiskParams = {
  /** Reserve (or eMode) max LTV as a fraction. The Aave `'36'` boundary. */
  ltv: number;
  /** Liquidation threshold as a fraction. */
  liquidationThreshold: number;
};

export type LeverageLegProjection = {
  /** Slippage floor to post as the intent's `minCollateralOut`. Never zero. */
  minCollateralOut: bigint;
  /** Collateral the position holds after the fill, at the floor. */
  collateralUsd: number;
  debtUsd: number;
  ltv: number;
  /** Aave health factor at the floor; `Infinity` with no debt. */
  healthFactor: number;
  /**
   * Whether the pool would reject the borrow outright. This is the Aave `'36'` check, and the one
   * thing a caller must not post through: the intent is accepted and fails at fill.
   */
  exceedsMaxLtv: boolean;
  /**
   * Fraction of the input's oracle value the solver keeps, measured from the QUOTE rather than the
   * floor — the expected cost of the leg, not the worst permitted one. Negative when the quote beats
   * parity, which a correlated pair can do.
   */
  haircut: number;
  /** Oracle value handed to the solver: the borrow, plus the contribution on a debt-side open. */
  inputUsd: number;
  /**
   * What the leg costs once, in the same units as the prices — `inputUsd x haircut`. Paid up front
   * and in full, unlike the yield it buys, so it is what a payback period is measured against.
   * Negative when the quote beat parity.
   */
  costUsd: number;
  /**
   * The most leverage this price actually supports, from `debt <= ltv x collateral` with `f` as the
   * USD of collateral the floor returns per USD handed to the solver:
   *
   *   debt side:       L <= 1 / (1 - ltv x f)          — the deposit buys collateral, none is supplied
   *   collateral side: L <= 1 + ltv / (1 - ltv x f)    — the deposit is also collateral
   *
   * At `f = 1` the second collapses to the familiar `1 / (1 - ltv)`. Below 1 it is strictly lower,
   * which is the whole point: `ltv` 91% with `f` 0.9877 gives 9.88x, and the 11.03x that looked fine
   * against oracle parity was never available. Above `f = 1 / ltv` there is no ceiling at all and
   * this is `Infinity` — a favourable enough fill adds borrowing power faster than debt.
   */
  usableMaxLeverage: number;
};

/**
 * Phase 2: the floor to post, the position that results from it, and the leverage ceiling this quote
 * actually supports.
 *
 * `slippagePct` is a percentage (1 means 1%) and comes off what the solver QUOTED, not off the input
 * amount — sizing the floor as `deposit x leverage x (1 - slippage)` assumes 1:1 token parity and put
 * earlier attempts above what the solver would pay, which made them unfillable.
 */
export function projectLeverageLeg(
  request: LeverageLegRequest,
  quote: LeverageLegQuote,
  risk: ReserveRiskParams,
  slippagePct: number,
): LeverageLegProjection {
  const { side, collateralPriceUsd, leverage } = request;
  const { depositUsd, borrowUsd } = sizeLeverageBorrow(request);

  const floor = (quote.quotedCollateral * BigInt(Math.round((100 - slippagePct) * 100))) / 10_000n;
  const minCollateralOut = floor > 0n ? floor : 1n;

  const floorUsd = Number(formatUnits(minCollateralOut, quote.collateralDecimals)) * collateralPriceUsd;
  const quotedUsd = Number(formatUnits(quote.quotedCollateral, quote.collateralDecimals)) * collateralPriceUsd;
  // On a debt-side open the contribution is handed over too, so the input is the whole `deposit x L`.
  const inputUsd = side === 'debt' ? depositUsd * leverage : borrowUsd;

  const f = inputUsd > 0 ? floorUsd / inputUsd : 0;
  const haircut = inputUsd > 0 ? 1 - quotedUsd / inputUsd : 0;

  const collateralUsd = (side === 'debt' ? 0 : depositUsd) + floorUsd;
  const debtUsd = borrowUsd;
  const ltv = collateralUsd > 0 ? debtUsd / collateralUsd : 0;

  /**
   * `ltv x f >= 1` is not a degenerate case, it is the UNBOUNDED one: every extra turn then adds more
   * borrowing power than it adds debt, so no finite ceiling exists. Reporting `1` there — as this did
   * first — inverts the answer at exactly the most favourable prices, and does so discontinuously:
   * at ltv 91% the ceiling climbs 9.88x (f 0.9877) to 11.1x (f 1.0) to 22.5x (f 1.05), then fell to
   * "no leverage possible" the moment f passed 1/0.91.
   *
   * `ltv == 0` genuinely is 1: borrowing is disabled, so leverage cannot exceed the deposit.
   */
  const ltvF = risk.ltv * f;
  const usableMaxLeverage =
    risk.ltv <= 0
      ? 1
      : ltvF >= 1
        ? Number.POSITIVE_INFINITY
        : side === 'debt'
          ? 1 / (1 - ltvF)
          : 1 + risk.ltv / (1 - ltvF);

  return {
    minCollateralOut,
    collateralUsd,
    debtUsd,
    ltv,
    healthFactor: debtUsd > 0 ? (collateralUsd * risk.liquidationThreshold) / debtUsd : Number.POSITIVE_INFINITY,
    exceedsMaxLtv: ltv > risk.ltv,
    haircut,
    inputUsd,
    costUsd: inputUsd * haircut,
    usableMaxLeverage,
  };
}
