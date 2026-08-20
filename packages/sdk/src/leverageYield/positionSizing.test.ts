import { describe, expect, it } from 'vitest';
import { parseUnits } from 'viem';
import { type LeverageLegRequest, projectLeverageLeg, sizeLeverageBorrow } from './positionSizing.js';

/**
 * The sUSDS / USSD loop these were derived from: an 18-decimal collateral reserve at ~1.07 and an
 * 18-decimal debt reserve at ~1.00, in eMode 3 (ltv 91%, liquidation threshold 97%).
 */
const RISK = { ltv: 0.91, liquidationThreshold: 0.97 };
const COLLATERAL_PRICE = 1.07;
const BORROW_PRICE = 1.0;

function request(overrides: Partial<LeverageLegRequest> = {}): LeverageLegRequest {
  return {
    side: 'collateral',
    deposit: parseUnits('1', 18),
    depositDecimals: 18,
    collateralPriceUsd: COLLATERAL_PRICE,
    borrowPriceUsd: BORROW_PRICE,
    borrowDecimals: 18,
    leverage: 2,
    ...overrides,
  };
}

describe('sizeLeverageBorrow', () => {
  it('borrows equity x (leverage - 1), priced off the collateral on a collateral-side open', () => {
    const sized = sizeLeverageBorrow(request({ leverage: 3 }));
    // 1 sUSDS at 1.07 is $1.07 of equity; 3x needs $2.14 of debt, which at $1 is 2.14 tokens.
    expect(sized.depositUsd).toBeCloseTo(1.07, 10);
    expect(sized.borrowUsd).toBeCloseTo(2.14, 10);
    expect(sized.borrowAmount).toBe(parseUnits('2.14', 18));
    // Nothing of the user's own goes to the solver on this side.
    expect(sized.intentInput).toBe(sized.borrowAmount);
  });

  it('prices the deposit with the DEBT token on a debt-side open, and adds it to the solver input', () => {
    const sized = sizeLeverageBorrow(request({ side: 'debt', leverage: 3 }));
    // The deposit is USSD here, so $1.00 — not $1.07. Using the collateral price overstated the
    // deposit by the whole pair spread, which is one half of the reported AAVE 36 failure.
    expect(sized.depositUsd).toBeCloseTo(1.0, 10);
    expect(sized.borrowAmount).toBe(parseUnits('2', 18));
    // The contribution is handed to the solver too: the debt-side hook is paid both.
    expect(sized.intentInput).toBe(parseUnits('3', 18));
  });

  it('borrows nothing at 1x, and never a negative amount below it', () => {
    expect(sizeLeverageBorrow(request({ leverage: 1 })).borrowAmount).toBe(0n);
    expect(sizeLeverageBorrow(request({ leverage: 0.5 })).borrowAmount).toBe(0n);
  });
});

describe('projectLeverageLeg', () => {
  /** A quote that pays `ratio` x the input's oracle value, in collateral tokens. */
  const quoteAt = (intentInputUsd: number, ratio: number) => ({
    quotedCollateral: parseUnits(((intentInputUsd * ratio) / COLLATERAL_PRICE).toFixed(18), 18),
    collateralDecimals: 18,
  });

  it('takes the floor off the QUOTE, not off the input', () => {
    const req = request({ leverage: 3 });
    const quote = quoteAt(2.14, 1);
    const { minCollateralOut } = projectLeverageLeg(req, quote, RISK, 1);
    expect(minCollateralOut).toBe((quote.quotedCollateral * 9900n) / 10_000n);
  });

  it('never posts a zero floor', () => {
    const req = request({ leverage: 3 });
    const { minCollateralOut } = projectLeverageLeg(req, { quotedCollateral: 1n, collateralDecimals: 18 }, RISK, 1);
    expect(minCollateralOut).toBe(1n);
  });

  it('counts the deposit as collateral on a collateral-side open but NOT on a debt-side one', () => {
    const collateralSide = projectLeverageLeg(request({ leverage: 3 }), quoteAt(2.14, 1), RISK, 0);
    // $1.07 supplied + $2.14 bought.
    expect(collateralSide.collateralUsd).toBeCloseTo(3.21, 6);

    const debtSide = projectLeverageLeg(request({ side: 'debt', leverage: 3 }), quoteAt(3, 1), RISK, 0);
    // Only what the solver delivered: the $1 contribution went to the solver, it was not supplied.
    expect(debtSide.collateralUsd).toBeCloseTo(3.0, 6);
    expect(debtSide.debtUsd).toBeCloseTo(2.0, 6);
  });

  /**
   * THE REGRESSION THAT MATTERS. A debt-side open at 11.03x with a ~1.2% haircut: oracle parity put
   * the LTV at ~84% and it was really 92.06% against a 91% cap, so the borrow reverted with '36'
   * after the solver had already filled.
   */
  it('reports the real LTV on a debt-side open, and flags the AAVE 36 boundary parity misses', () => {
    const req = request({ side: 'debt', leverage: 11.03 });
    const projection = projectLeverageLeg(req, quoteAt(11.03, 0.9877), RISK, 0);

    // debt/collateral = (L-1) / (L x f), which parity (f = 1) would report as 10.03/11.03 = 90.9%.
    expect(projection.ltv).toBeCloseTo(10.03 / (11.03 * 0.9877), 4);
    expect(projection.ltv).toBeGreaterThan(RISK.ltv);
    expect(projection.exceedsMaxLtv).toBe(true);
    // And it says how far it could have gone: `1 / (1 - 0.91 x 0.9877)`.
    expect(projection.usableMaxLeverage).toBeCloseTo(1 / (1 - RISK.ltv * 0.9877), 4);
    expect(projection.usableMaxLeverage).toBeLessThan(11.03);
  });

  it('a leg sized at the usable max is accepted, and one step past it is not', () => {
    const at = projectLeverageLeg(request({ side: 'debt', leverage: 9.88 }), quoteAt(9.88, 0.9877), RISK, 0);
    expect(at.exceedsMaxLtv).toBe(false);
    const past = projectLeverageLeg(request({ side: 'debt', leverage: 10.5 }), quoteAt(10.5, 0.9877), RISK, 0);
    expect(past.exceedsMaxLtv).toBe(true);
  });

  /**
   * The branch the review flagged: past `f = 1 / ltv` each turn adds more borrowing power than debt,
   * so there is no ceiling. This used to report `1` — "no leverage possible" — at the most favourable
   * prices, and got there by a discontinuous drop from ~10^6.
   */
  it('reports no ceiling once the fill is favourable enough to be self-financing', () => {
    const justUnder = projectLeverageLeg(request({ side: 'debt', leverage: 2 }), quoteAt(2, 1.09), RISK, 0);
    expect(Number.isFinite(justUnder.usableMaxLeverage)).toBe(true);
    expect(justUnder.usableMaxLeverage).toBeGreaterThan(11);

    // ltv 0.91 x f 1.15 = 1.0465, past the 1/0.91 crossing.
    for (const side of ['debt', 'collateral'] as const) {
      const past = projectLeverageLeg(request({ side, leverage: 2 }), quoteAt(2, 1.15), RISK, 0);
      expect(past.usableMaxLeverage).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it('reports a ceiling of 1 when borrowing is disabled outright', () => {
    const projection = projectLeverageLeg(request({ leverage: 2 }), quoteAt(1.07, 1), { ...RISK, ltv: 0 }, 0);
    expect(projection.usableMaxLeverage).toBe(1);
  });

  it('collapses to the textbook ceiling when the solver takes nothing', () => {
    const collateralSide = projectLeverageLeg(request({ leverage: 2 }), quoteAt(1.07, 1), RISK, 0);
    // 1 + ltv/(1 - ltv) === 1/(1 - ltv) at f = 1.
    expect(collateralSide.usableMaxLeverage).toBeCloseTo(1 / (1 - RISK.ltv), 6);
    const debtSide = projectLeverageLeg(request({ side: 'debt', leverage: 2 }), quoteAt(2, 1), RISK, 0);
    expect(debtSide.usableMaxLeverage).toBeCloseTo(1 / (1 - RISK.ltv), 6);
  });

  it('measures the haircut from the quote, and reports a negative one when the quote beats parity', () => {
    const worse = projectLeverageLeg(request({ leverage: 3 }), quoteAt(2.14, 0.99), RISK, 0);
    expect(worse.haircut).toBeCloseTo(0.01, 6);
    const better = projectLeverageLeg(request({ leverage: 3 }), quoteAt(2.14, 1.005), RISK, 0);
    expect(better.haircut).toBeCloseTo(-0.005, 6);
  });

  it('slippage widens the gap between the floor and the quote without moving the haircut', () => {
    const req = request({ leverage: 3 });
    const quote = quoteAt(2.14, 0.99);
    const tight = projectLeverageLeg(req, quote, RISK, 0.5);
    const loose = projectLeverageLeg(req, quote, RISK, 5);
    // The haircut is the expected cost, so tolerance does not change it...
    expect(loose.haircut).toBeCloseTo(tight.haircut, 10);
    // ...but the projection is from the floor, so a looser tolerance is a worse projected position.
    expect(loose.minCollateralOut).toBeLessThan(tight.minCollateralOut);
    expect(loose.ltv).toBeGreaterThan(tight.ltv);
    expect(loose.usableMaxLeverage).toBeLessThan(tight.usableMaxLeverage);
  });

  it('reports an infinite health factor when nothing is borrowed', () => {
    const projection = projectLeverageLeg(request({ leverage: 1 }), quoteAt(0, 1), RISK, 1);
    expect(projection.healthFactor).toBe(Number.POSITIVE_INFINITY);
    expect(projection.exceedsMaxLtv).toBe(false);
  });

  it('health factor crosses 1 exactly where debt reaches the liquidation threshold', () => {
    const projection = projectLeverageLeg(request({ leverage: 3 }), quoteAt(2.14, 1), RISK, 0);
    // collateral 3.21 x 0.97 / debt 2.14
    expect(projection.healthFactor).toBeCloseTo((3.21 * 0.97) / 2.14, 6);
    expect(projection.healthFactor).toBeGreaterThan(1);
  });
});
