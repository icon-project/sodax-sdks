/**
 * Adjust-leverage control: one target-leverage slider that goes both ways.
 *
 * Leverage is collateral / equity, where equity is the part of the position that is yours
 * (`collateral - debt`). Both directions leave equity unchanged — borrowing and swapping into
 * collateral raises both sides equally; selling collateral to repay lowers both equally — so a
 * single identity covers the whole slider:
 *
 *   target × equity = collateral after
 *
 * Above the current leverage that difference is borrowed (`addLeverage`); below it, that much
 * collateral is sold to repay debt (`decreaseLeverage`). Which call to make is therefore just the
 * sign of the difference, which is why this is one control rather than two.
 *
 * Everything is computed in the pool's base currency (8 dp), what `getUserAccountData` reports, then
 * converted into token units for the call.
 *
 * NOTE ON SETTLEMENT: both directions only *post* an intent — a solver fills it afterwards. A
 * successful transaction means the intent is live, not that leverage moved. The position refuses a
 * second operation until this one fills, expires, or is cancelled.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  useSodaxContext,
  useReservesUsdFormat,
  type LeveragePositionAccount,
  type SpokeChainKey,
} from '@sodax/dapp-kit';
import { formatUnits, parseUnits, type Address } from 'viem';
import { fmtHealthFactor, getReadableTxError } from '@/lib/utils';
import { useSubmitPositionIntent } from './useHubWalletRoute';
import { useLegQuote } from './useLegQuote';
import { LeveragedApyPanel, apyPctFromReserve } from './LeveragedApyPanel';

/** `getUserAccountData` reports base-currency amounts with 8 decimals on the Sodax fork. */
const BASE_DP = 8;
const WAD = 10n ** 18n;
/** Stay a touch under the pool's own limit so a borrow doesn't revert on rounding. */
const MAX_LEVERAGE_SAFETY = 0.98;
/** Ignore slider noise — below this the adjustment rounds to nothing worth a transaction. */
const MIN_ADJUSTMENT = 0.01;

function toNumber(base: bigint): number {
  return Number(base) / 10 ** BASE_DP;
}

export function AdjustLeverageControl({
  chain,
  position,
  account,
  collateralToken,
  borrowToken,
  owner,
  pending,
}: {
  chain: SpokeChainKey;
  position: Address;
  account: LeveragePositionAccount;
  collateralToken: Address;
  borrowToken: Address;
  owner: Address | undefined;
  pending: boolean;
}) {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();
  const submitIntent = useSubmitPositionIntent(chain);
  const { data: reserves } = useReservesUsdFormat();

  const [slippagePct, setSlippagePct] = useState(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  const reserveFor = useCallback(
    (token: Address) => reserves?.find(r => r.underlyingAsset.toLowerCase() === token.toLowerCase()),
    [reserves],
  );
  const borrowReserve = useMemo(() => reserveFor(borrowToken), [reserveFor, borrowToken]);
  const collateralReserve = useMemo(() => reserveFor(collateralToken), [reserveFor, collateralToken]);

  const collateral = toNumber(account.totalCollateralBase);
  const debt = toNumber(account.totalDebtBase);
  const equity = collateral - debt;
  // `ltv` is the account's max borrowing power in bps, already blended across collateral and
  // reflecting the position's eMode category — so it is the right ceiling, not a reserve constant.
  const maxLtv = Number(account.ltv) / 10_000;
  const liqThreshold = Number(account.currentLiquidationThreshold) / 10_000;

  const currentLeverage = equity > 0 ? collateral / equity : 1;
  const maxLeverage = maxLtv > 0 && maxLtv < 1 ? (1 / (1 - maxLtv)) * MAX_LEVERAGE_SAFETY : 1;

  const [target, setTarget] = useState<number | undefined>();
  const targetLeverage = target ?? currentLeverage;

  /**
   * ORACLE SIZING ONLY — how big the operation is. `projected` below is what the position really looks
   * like afterwards; see there for why the two differ and why it matters.
   */
  const quote = useMemo(() => {
    if (equity <= 0) return undefined;
    const projectedCollateral = targetLeverage * equity;
    // Equity is unchanged in both directions, so the collateral delta is also the debt delta.
    const deltaBase = projectedCollateral - collateral;
    if (Math.abs(deltaBase) < MIN_ADJUSTMENT) return undefined;
    const projectedDebt = debt + deltaBase;
    return {
      direction: deltaBase > 0 ? ('increase' as const) : ('decrease' as const),
      deltaBase: Math.abs(deltaBase),
      projectedCollateral,
      projectedDebt,
      projectedLtv: projectedCollateral > 0 ? projectedDebt / projectedCollateral : 0,
      // HF is collateral × liquidation threshold ÷ debt, the same identity the pool uses. With the
      // debt fully repaid the pool reports "no debt" rather than a ratio, so mirror its sentinel.
      projectedHfWad:
        projectedDebt > 0
          ? BigInt(Math.floor(((projectedCollateral * liqThreshold) / projectedDebt) * 1e18))
          : 2n ** 256n - 1n,
    };
  }, [equity, targetLeverage, collateral, debt, liqThreshold]);

  /**
   * The intent's input amount, in the units of whichever token is being given up: the borrow token
   * when increasing (borrow it, swap into collateral), the collateral when decreasing (sell it to
   * repay). Base currency is USD-denominated on this pool, so base ÷ price gives token units.
   */
  const inputAmount = useMemo(() => {
    if (!quote) return undefined;
    const reserve = quote.direction === 'increase' ? borrowReserve : collateralReserve;
    if (!reserve) return undefined;
    const price = Number(reserve.priceInUSD);
    if (!(price > 0)) return undefined;
    return parseUnits((quote.deltaBase / price).toFixed(reserve.decimals), reserve.decimals);
  }, [quote, borrowReserve, collateralReserve]);

  // A real solver quote for this leg — both the executable price and proof the solver supports the
  // pair. The projection above is oracle math, which cannot tell an unsupported pair from a slow one.
  const legQuote = useLegQuote({
    inputHubToken: quote ? (quote.direction === 'increase' ? borrowToken : collateralToken) : undefined,
    outputHubToken: quote ? (quote.direction === 'increase' ? collateralToken : borrowToken) : undefined,
    amount: inputAmount,
  });

  /**
   * Slippage floor, off the quoted output. Hoisted out of the submit handler because the projection has
   * to be built from the same number the intent will carry — deriving it twice is how a display and a
   * transaction drift apart.
   */
  const minOut = useMemo(() => {
    if (!legQuote.data) return undefined;
    const floor = (legQuote.data.outputAmount * BigInt(Math.round((100 - slippagePct) * 100))) / 10_000n;
    return floor > 0n ? floor : 1n;
  }, [legQuote.data, slippagePct]);

  /**
   * The real post-trade position, priced off the solver's FLOOR rather than the oracle.
   *
   * Both directions lose the solver's cut, and in both it lands on the side that hurts. Levering up
   * supplies the solver's collateral and then borrows against it, so a haircut means less collateral
   * backing the same debt — that is the AAVE 36 (COLLATERAL_CANNOT_COVER_NEW_BORROW) failure. Levering
   * down gives up an exact amount of collateral and repays only what the solver delivers, so a haircut
   * leaves more debt than projected. Oracle parity misses both.
   *
   * Projected from the floor because that is the worst fill the intent allows: safe at the floor means
   * safe at every fill.
   */
  const projected = useMemo(() => {
    if (!quote || !minOut || !legQuote.data) return undefined;
    const floor = Number(formatUnits(minOut, legQuote.data.outputDecimals));
    const outPrice = Number((quote.direction === 'increase' ? collateralReserve : borrowReserve)?.priceInUSD ?? 0);
    if (!(outPrice > 0)) return undefined;
    const floorUsd = floor * outPrice;

    const collateralAfter = quote.direction === 'increase' ? collateral + floorUsd : collateral - quote.deltaBase;
    const debtAfter = quote.direction === 'increase' ? debt + quote.deltaBase : Math.max(debt - floorUsd, 0);
    const haircut = quote.deltaBase > 0 ? 1 - floorUsd / quote.deltaBase : 0;

    return {
      collateralAfter,
      debtAfter,
      ltv: collateralAfter > 0 ? debtAfter / collateralAfter : 0,
      hfWad:
        debtAfter > 0 ? BigInt(Math.floor(((collateralAfter * liqThreshold) / debtAfter) * 1e18)) : 2n ** 256n - 1n,
      haircut,
      // Only an increase can be rejected by the pool: a decrease reduces debt, which never trips it.
      exceedsMaxLtv: quote.direction === 'increase' && collateralAfter > 0 && debtAfter / collateralAfter > maxLtv,
    };
  }, [quote, minOut, legQuote.data, collateralReserve, borrowReserve, collateral, debt, liqThreshold, maxLtv]);

  /**
   * Entry cost of this adjustment and the equity it earns back on.
   *
   * Only for an INCREASE. Levering down also pays the solver, but it lowers the yield rather than
   * raising it, so no holding period repays it — it buys risk reduction, not return, and reporting a
   * payback period there would be nonsense.
   *
   * The cost is measured against the QUOTE, not `projected`'s floor: the floor is deliberately the
   * worst permitted fill for safety, while a payback period wants the fill expected. Equity is
   * collateral less debt, which is what the incremental rate actually accrues on.
   */
  const breakeven = useMemo(() => {
    if (!quote || quote.direction !== 'increase' || !legQuote.data) return undefined;
    const outPrice = Number(collateralReserve?.priceInUSD ?? 0);
    if (!(outPrice > 0) || !(quote.deltaBase > 0)) return undefined;
    const quotedUsd = Number(formatUnits(legQuote.data.outputAmount, legQuote.data.outputDecimals)) * outPrice;
    const equityUsd = collateral - debt;
    if (!(equityUsd > 0)) return undefined;
    return { costUsd: quote.deltaBase - quotedUsd, equityUsd, fromLeverage: currentLeverage };
  }, [quote, legQuote.data, collateralReserve, collateral, debt, currentLeverage]);

  const onAdjust = useCallback(async () => {
    if (!owner || !quote || !inputAmount || !legQuote.data || !minOut) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      // Slippage comes off what the solver actually quoted, not off the input amount — see `minOut`.
      const floor = minOut;
      const tx =
        quote.direction === 'increase'
          ? sodax.leverageYield.buildAddLeverage({
              from: owner,
              position,
              borrowAmount: inputAmount,
              minCollateralOut: floor,
            })
          : sodax.leverageYield.buildDecreaseLeverage({
              from: owner,
              position,
              collateralIn: inputAmount,
              minDebtOut: floor,
            });

      // Routed as the hub wallet, reported to the solver, and recorded — one path, see
      // useSubmitPositionIntent. Progress from here is the order panel's job, not a status string.
      const inSymbol = (quote.direction === 'increase' ? borrowReserve : collateralReserve)?.symbol ?? '';
      const result = await submitIntent({
        calls: [tx],
        from: {
          amount: formatUnits(
            inputAmount,
            (quote.direction === 'increase' ? borrowReserve : collateralReserve)?.decimals ?? 18,
          ),
          symbol: inSymbol,
        },
        to: {
          symbol: legQuote.data.outputSymbol,
          decimals: legQuote.data.outputDecimals,
          quoted: legQuote.data.outputAmount,
        },
      });
      setStatus(
        result.notified
          ? 'Intent posted and reported to the solver — progress is below.'
          : `Intent posted, but the solver would not accept it: ${result.error}. It will expire and can then be cancelled.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
    } catch (e) {
      setError(getReadableTxError(e));
    } finally {
      setBusy(false);
    }
  }, [
    owner,
    quote,
    inputAmount,
    legQuote.data,
    minOut,
    sodax,
    position,
    submitIntent,
    borrowReserve,
    collateralReserve,
    queryClient,
  ]);

  if (equity <= 0) {
    return <div className="text-xs text-muted-foreground">No equity in this position — nothing to adjust.</div>;
  }

  const deltaReserve = quote?.direction === 'increase' ? borrowReserve : collateralReserve;

  return (
    <div className="space-y-2 border-t pt-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Target leverage</Label>
        <span className="font-mono text-xs">{targetLeverage.toFixed(2)}x</span>
      </div>
      {/* Spans 1x upward, so dragging left deleverages and right levers up. 1x is a full repay. */}
      <input
        type="range"
        className="w-full"
        min={1}
        max={Math.max(maxLeverage, currentLeverage)}
        step={0.01}
        value={targetLeverage}
        onChange={e => setTarget(Number(e.target.value))}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>1.00x (no debt)</span>
        <span>now {currentLeverage.toFixed(2)}x</span>
        <span>max {maxLeverage.toFixed(2)}x</span>
      </div>

      {quote && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">{quote.direction === 'increase' ? 'borrow' : 'sell collateral'}</span>
          <span className="text-right font-mono text-xs">
            {quote.deltaBase.toFixed(2)} {deltaReserve ? `(${deltaReserve.symbol})` : ''}
          </span>
          <span className="text-muted-foreground">collateral after</span>
          <span className="text-right font-mono text-xs">
            {(projected?.collateralAfter ?? quote.projectedCollateral).toFixed(2)}
          </span>
          <span className="text-muted-foreground">debt after</span>
          <span className="text-right font-mono text-xs">
            {(projected?.debtAfter ?? quote.projectedDebt).toFixed(2)}
          </span>
          <span className="text-muted-foreground">ltv after</span>
          <span className={`text-right font-mono text-xs ${projected?.exceedsMaxLtv ? 'text-negative' : ''}`}>
            {((projected?.ltv ?? quote.projectedLtv) * 100).toFixed(2)}%
            {projected?.exceedsMaxLtv && ` > ${(maxLtv * 100).toFixed(2)}% max`}
          </span>
          <span className="text-muted-foreground">solver quote</span>
          <span className="text-right font-mono text-xs">
            {legQuote.isLoading
              ? 'quoting…'
              : legQuote.data
                ? `${Number(formatUnits(legQuote.data.outputAmount, legQuote.data.outputDecimals)).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 6 },
                  )} ${legQuote.data.outputSymbol}`
                : '—'}
          </span>
          <span className="text-muted-foreground">health factor after</span>
          <span
            className={`text-right font-mono text-xs ${(projected?.hfWad ?? quote.projectedHfWad) < WAD ? 'text-negative' : 'text-cherry-soda'}`}
          >
            {fmtHealthFactor(projected?.hfWad ?? quote.projectedHfWad)}
          </span>
          {projected && (
            <>
              <span className="text-muted-foreground">solver keeps (fee + slippage)</span>
              <span className="text-right font-mono text-xs">{(projected.haircut * 100).toFixed(2)}%</span>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Label className="text-xs whitespace-nowrap">slippage %</Label>
        <input
          type="range"
          className="flex-1"
          min={0.1}
          max={5}
          step={0.1}
          value={slippagePct}
          onChange={e => setSlippagePct(Number(e.target.value))}
        />
        <span className="font-mono text-xs w-8 text-right">{slippagePct.toFixed(1)}</span>
      </div>

      {projected?.exceedsMaxLtv && (
        <div className="text-xs text-negative">
          At this leverage the solver's price leaves LTV at {(projected.ltv * 100).toFixed(2)}%, above the{' '}
          {(maxLtv * 100).toFixed(2)}% the pool allows — the borrow would revert on fill (AAVE 36) and the intent would
          be wasted. Lower the target, or tighten slippage so the floor is closer to the quote.
        </div>
      )}
      {legQuote.error && (
        <div className="text-xs text-negative break-all">
          The solver will not quote this pair: {legQuote.error.message}. Without a quote the intent would post and then
          expire, so this is blocked rather than attempted.
        </div>
      )}

      {collateralReserve && borrowReserve && (
        <LeveragedApyPanel
          supplyApyPct={apyPctFromReserve(collateralReserve.supplyAPY)}
          borrowApyPct={apyPctFromReserve(borrowReserve.variableBorrowAPY)}
          leverage={targetLeverage}
          currentLeverage={currentLeverage}
          collateralSymbol={collateralReserve.symbol}
          borrowSymbol={borrowReserve.symbol}
          breakeven={breakeven}
        />
      )}

      <Button
        className="w-full"
        size="sm"
        disabled={
          !inputAmount || !legQuote.data || legQuote.isLoading || busy || !owner || pending || projected?.exceedsMaxLtv
        }
        onClick={onAdjust}
      >
        {busy
          ? 'Posting intent…'
          : pending
            ? 'An operation is already in flight'
            : legQuote.isLoading
              ? 'Quoting…'
              : quote?.direction === 'decrease'
                ? 'Decrease leverage'
                : 'Add leverage'}
      </Button>

      {status && <div className="text-xs text-cherry-soda break-all">{status}</div>}
      {error && <div className="text-xs text-negative break-all">{error}</div>}
      <div className="text-[10px] text-muted-foreground">
        Posts an intent for a solver to fill; the position stays unchanged until it does.
      </div>
    </div>
  );
}
