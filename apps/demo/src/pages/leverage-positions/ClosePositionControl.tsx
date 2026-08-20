/**
 * Close-position control.
 *
 * Closing means clearing the debt, and clearing the debt means selling collateral through a solver —
 * so it is never one transaction, and the UI is shaped around that rather than hiding it. What the
 * user gets to choose is which asset they leave with:
 *
 *   EXIT INTO COLLATERAL — sell only as much collateral as the debt is worth, then withdraw the rest.
 *     Two steps, and the withdrawal can pay out to any address, so it goes to the signer's own wallet.
 *
 *   EXIT INTO THE DEBT TOKEN — sell the whole collateral balance in one go. The solver delivers more
 *     debt token than is owed, the hook repays the debt and leaves the surplus in the position, and
 *     `settle` sweeps it to the position's owner. That is the natural exit for someone who arrived
 *     from the debt side and wants the same asset back rather than the collateral.
 *
 * Both are the same `decreaseLeverage` call; the difference is only how much collateral it sells.
 *
 * Phases are driven by the position's own state rather than local flags, so a reload or a fill that
 * lands while the page is closed picks up where it left off:
 *
 *   1. debt > 0      → sell collateral to repay it
 *   2. debt == 0     → withdraw whatever collateral is left (nothing to do after a full exit)
 *
 * WHY A FULL EXIT CANNOT HALF-HAPPEN: the hook repays the debt and then withdraws all the collateral
 * to pay the solver. If the delivered amount fell short of the debt, that withdrawal would leave debt
 * standing against no collateral, and the pool's health-factor check rejects it — the whole fill
 * reverts and the position is untouched. So a full exit either clears the debt or does nothing, which
 * is also why this blocks rather than posts when the quote would not cover the debt.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  useSodaxContext,
  useReservesUsdFormat,
  useLeveragePositionCollateral,
  type LeveragePositionAccount,
  type SpokeChainKey,
} from '@sodax/dapp-kit';
import { formatUnits, parseUnits, type Address } from 'viem';
import { getReadableTxError } from '@/lib/utils';
import { useHubWalletRoute, usePositionPayoutAddress, useSubmitPositionIntent } from './useHubWalletRoute';
import { useLegQuote } from './useLegQuote';

/** `getUserAccountData` reports base-currency amounts with 8 decimals on the Sodax fork. */
const BASE_DP = 8;
/**
 * Sell slightly more collateral than the debt is worth. Debt accrues interest between quoting and
 * filling, and the swap itself can come in under quote — repaying a hair too much just leaves the
 * remainder as collateral to withdraw in phase 2, whereas repaying too little leaves dust debt that
 * blocks the withdrawal entirely. Doubles as the margin the full exit's coverage check must clear.
 */
const REPAY_OVERSHOOT = 1.01;
/** Below this the position is empty enough to treat as closed rather than offering another leg. */
const DUST_BASE = 0.01;

type ExitAsset = 'collateral' | 'debt';

function toNumber(base: bigint): number {
  return Number(base) / 10 ** BASE_DP;
}

export function ClosePositionControl({
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
  const { route } = useHubWalletRoute(chain);
  const submitIntent = useSubmitPositionIntent(chain);
  // Not the signer: off the hub, the signer's address is not one the hub could pay out to.
  const payoutAddress = usePositionPayoutAddress(chain, owner);
  const { data: reserves } = useReservesUsdFormat();
  // The exact aToken balance, which is the only thing that can size "sell everything" — the account
  // snapshot's base-currency collateral divided by a price lands near the balance, not on it, and
  // asking for more than the position holds expires as an unfillable intent.
  const { data: held } = useLeveragePositionCollateral({ params: { position, collateral: collateralToken } });

  const [exit, setExit] = useState<ExitAsset>('collateral');
  const [slippagePct, setSlippagePct] = useState(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  const reserveFor = useCallback(
    (token: Address) => reserves?.find(r => r.underlyingAsset.toLowerCase() === token.toLowerCase()),
    [reserves],
  );
  const collateralReserve = useMemo(() => reserveFor(collateralToken), [reserveFor, collateralToken]);
  const borrowReserve = useMemo(() => reserveFor(borrowToken), [reserveFor, borrowToken]);

  /**
   * The token a full exit is delivered in — the debt reserve's own underlying, so exiting "to USSD"
   * hands over USSD rather than sodaUSSD. The hook unwraps and sends it to the owner's own address on
   * their origin chain, the same route a refund takes.
   *
   * `undefined` when the reserve IS the underlying (nothing to unwrap) or when the pair is not in the
   * registry; the surplus then stays in the position for `settle` to sweep, which is the old behaviour
   * and never worse than it.
   */
  const exitDelivery = useMemo(() => {
    // Resolved against the user's OWN chain, not from the hub asset alone. Delivery off-hub goes through
    // the AssetManager, which only moves assets registered for the destination — and one hub reserve can
    // back different registered assets per chain, so a chain-agnostic lookup can name one the
    // destination has never heard of. Matching on the reserve within this chain's own token list keeps
    // the asset and the destination in step.
    const onThisChain = sodax.moneyMarket
      .getSupportedTokensByChainId(chain)
      .find(t => t.vault?.toLowerCase() === borrowToken.toLowerCase());
    const asset = onThisChain?.hubAsset as Address | undefined;
    if (!asset || asset.toLowerCase() === borrowToken.toLowerCase()) return undefined;
    // The symbol travels with the address on purpose. The solver is quoted and pays in the RESERVE
    // (sodaUSSD); the hook unwraps that into this asset before it reaches you. Labelling the exit with
    // the reserve's symbol described the intermediate step rather than what lands in your wallet.
    return { asset, symbol: onThisChain?.symbol ?? 'the debt token' };
  }, [sodax, chain, borrowToken]);
  const exitAsset = exitDelivery?.asset;
  /** What a full exit actually delivers: the native asset when it is unwrapped, else the reserve. */
  const exitSymbol = exitDelivery?.symbol ?? borrowReserve?.symbol ?? 'the debt token';

  const collateral = toNumber(account.totalCollateralBase);
  const debt = toNumber(account.totalDebtBase);
  const phase = debt > DUST_BASE ? 'repay' : collateral > DUST_BASE ? 'withdraw' : 'closed';
  const fullExit = exit === 'debt';

  /** Collateral to sell, in collateral-token units: the whole balance for a full exit, else the debt's worth. */
  const repayInput = useMemo(() => {
    if (phase !== 'repay') return undefined;
    if (fullExit) return held?.balance;
    if (!collateralReserve) return undefined;
    const price = Number(collateralReserve.priceInUSD);
    if (!(price > 0)) return undefined;
    const needed = Math.min((debt * REPAY_OVERSHOOT) / price, collateral / price);
    return parseUnits(needed.toFixed(collateralReserve.decimals), collateralReserve.decimals);
  }, [phase, fullExit, held, collateralReserve, debt, collateral]);

  // The repay leg sells collateral for the borrow token, so quote it for real: the floor has to be
  // what the solver will pay, and a pair it does not support must fail here rather than as a silent
  // expiry that leaves the position stuck mid-close.
  const legQuote = useLegQuote({
    inputHubToken: phase === 'repay' ? collateralToken : undefined,
    outputHubToken: phase === 'repay' ? borrowToken : undefined,
    amount: repayInput,
  });

  /** Slippage floor, off the quoted output — the two legs are different tokens. */
  const minOut = useMemo(() => {
    if (!legQuote.data) return undefined;
    const floor = (legQuote.data.outputAmount * BigInt(Math.round((100 - slippagePct) * 100))) / 10_000n;
    return floor > 0n ? floor : 1n;
  }, [legQuote.data, slippagePct]);

  /**
   * Debt in borrow-token units, with the interest margin — what a full exit's fill has to deliver for
   * the pool to let the hook take the collateral. Oracle math, so approximate; it gates the button
   * rather than setting the floor, and the pool is the real enforcement either way.
   */
  const debtToCover = useMemo(() => {
    if (!fullExit || !borrowReserve) return undefined;
    const price = Number(borrowReserve.priceInUSD);
    if (!(price > 0)) return undefined;
    return parseUnits(((debt * REPAY_OVERSHOOT) / price).toFixed(borrowReserve.decimals), borrowReserve.decimals);
  }, [fullExit, borrowReserve, debt]);

  /** A full exit that would not clear the debt cannot fill at all — see the header note. */
  const shortOfDebt = fullExit && !!minOut && !!debtToCover && minOut < debtToCover;

  const onRepay = useCallback(async () => {
    if (!owner || !repayInput || !legQuote.data || !minOut) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const tx = sodax.leverageYield.buildDecreaseLeverage({
        from: owner,
        position,
        collateralIn: repayInput,
        minDebtOut: minOut,
        // Only a full exit produces a surplus, so only that case asks for delivery. A partial repay has
        // nothing left over and the argument is ignored on-chain either way.
        ...(fullExit && exitAsset ? { exitAsset } : {}),
      });
      const result = await submitIntent({
        calls: [tx],
        from: {
          amount: formatUnits(repayInput, collateralReserve?.decimals ?? 18),
          symbol: collateralReserve?.symbol ?? '',
        },
        to: {
          symbol: legQuote.data.outputSymbol,
          decimals: legQuote.data.outputDecimals,
          quoted: legQuote.data.outputAmount,
        },
      });
      const posted = fullExit
        ? exitAsset
          ? `Exit intent posted and reported to the solver. On fill the debt is repaid and the remainder arrives as ${exitSymbol} at your own address — no settle needed.`
          : `Exit intent posted and reported to the solver. On fill the debt is repaid and the rest of the ${legQuote.data.outputSymbol} stays in the position — settle to sweep it to the owner.`
        : 'Repay intent posted and reported to the solver. Once it fills, come back to withdraw.';
      setStatus(
        result.notified
          ? posted
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
    repayInput,
    legQuote.data,
    minOut,
    fullExit,
    exitAsset,
    exitSymbol,
    sodax,
    position,
    submitIntent,
    collateralReserve,
    queryClient,
  ]);

  const onWithdraw = useCallback(async () => {
    if (!owner || !payoutAddress) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      // uint256 max makes AAVE withdraw the entire aToken balance, which also sidesteps the
      // rounding trap of naming an exact amount against a rebasing balance.
      const tx = sodax.leverageYield.buildPositionWithdraw({
        from: owner,
        position,
        amount: 2n ** 256n - 1n,
        to: payoutAddress,
      });
      const { dstChainTxHash } = await route([tx]);
      setStatus(`Withdrawn to ${payoutAddress} (${dstChainTxHash.slice(0, 10)}…) — position closed`);
      await queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
    } catch (e) {
      setError(getReadableTxError(e));
    } finally {
      setBusy(false);
    }
  }, [owner, payoutAddress, sodax, position, route, queryClient]);

  if (phase === 'closed') {
    return <div className="text-xs text-muted-foreground">Position is empty — nothing left to close.</div>;
  }

  return (
    <div className="space-y-2 border-t pt-2">
      <div className="text-xs font-medium">Close position</div>

      {phase === 'repay' && (
        <>
          <div className="flex gap-1">
            {(
              [
                ['collateral', `keep ${collateralReserve?.symbol ?? 'collateral'}`],
                ['debt', `exit to ${exitSymbol}`],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                className="flex-1"
                size="sm"
                variant={exit === value ? 'default' : 'outline'}
                onClick={() => setExit(value)}
              >
                <span className="text-[10px]">{label}</span>
              </Button>
            ))}
          </div>

          <div className="text-[10px] text-muted-foreground">
            {fullExit ? (
              <>
                Sells the whole collateral balance to repay the {debt.toFixed(2)} of debt, in one operation. Whatever
                the sale brings in beyond the debt comes to you as {exitSymbol} —
                {exitAsset
                  ? ' unwrapped and sent straight to your own address on the chain you funded from — no settle step.'
                  : ' left in the position, which settle then sweeps to the hub wallet that owns it.'}{' '}
                A solver fills this, so nothing moves until it does.
              </>
            ) : (
              <>
                Step 1 of 2 — sells collateral to repay the {debt.toFixed(2)} of debt. A solver fills this, so the debt
                clears when the intent fills, not when the transaction confirms. Withdrawal unlocks after that.
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">selling</span>
            <span className="text-right font-mono text-xs">
              {repayInput !== undefined
                ? `${Number(formatUnits(repayInput, collateralReserve?.decimals ?? 18)).toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })} ${collateralReserve?.symbol ?? ''}`
                : fullExit
                  ? 'reading balance…'
                  : '—'}
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
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs whitespace-nowrap">slippage %</span>
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
          {legQuote.error && (
            <div className="text-xs text-negative break-all">
              The solver will not quote this pair: {legQuote.error.message}.
            </div>
          )}
          {shortOfDebt && (
            <div className="text-xs text-negative">
              Selling everything at this quote would not cover the debt, and the pool rejects a fill that leaves debt
              with no collateral behind it — so this would post and then expire. Tighten the slippage, or exit into the
              collateral instead and withdraw what is left.
            </div>
          )}
          <Button
            className="w-full"
            size="sm"
            variant="outline"
            disabled={!repayInput || !legQuote.data || legQuote.isLoading || busy || !owner || pending || shortOfDebt}
            onClick={onRepay}
          >
            {busy
              ? 'Posting intent…'
              : pending
                ? 'An operation is already in flight'
                : legQuote.isLoading
                  ? 'Quoting…'
                  : fullExit
                    ? `Sell everything for ${exitSymbol}`
                    : 'Step 1: repay all debt'}
          </Button>
        </>
      )}

      {phase === 'withdraw' && (
        <>
          <div className="text-[10px] text-muted-foreground">
            No debt left, so the whole {collateral.toFixed(2)} of collateral can come out. A withdrawal pays out on the
            hub, so it goes to your own address when you are on Sonic and to your hub wallet otherwise — bridging onward
            from there is a separate operation.
          </div>
          <Button
            className="w-full"
            size="sm"
            variant="outline"
            disabled={busy || !owner || !payoutAddress || pending}
            onClick={onWithdraw}
          >
            {busy ? 'Withdrawing…' : pending ? 'An operation is already in flight' : 'Withdraw everything'}
          </Button>
        </>
      )}

      {status && <div className="text-xs text-cherry-soda break-all">{status}</div>}
      {error && <div className="text-xs text-negative break-all">{error}</div>}
    </div>
  );
}
