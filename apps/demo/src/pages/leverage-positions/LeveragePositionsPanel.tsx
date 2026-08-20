/**
 * Leverage Positions panel.
 *
 * The unpooled counterpart to the vault flow on this page. A vault is one shared ERC-4626
 * position at a single target LTV; a leverage position is one AAVE account per user, so an
 * owner can hold several at different eMode categories and leverage tiers at once.
 *
 * Each row is a full lifecycle: health, adjust leverage in either direction, and close. Writes go
 * through the wallet router so they execute as the hub wallet that owns the position — see
 * `useHubWalletRoute`.
 *
 * Controls are gated on the position's own pending flag rather than local state, because a position
 * permits one intent at a time and that state changes without the user acting (a solver fills, or the
 * intent expires).
 */

import React, { useCallback, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  useLeveragePositionsForUser,
  useLeveragePositionAccount,
  useLeveragePositionInfo,
  useLeveragePositionPending,
  type SpokeChainKey,
} from '@sodax/dapp-kit';
import { AdjustLeverageControl } from './AdjustLeverageControl';
import { ClosePositionControl } from './ClosePositionControl';
import { PendingOperationControl } from './PendingOperationControl';
import { fmtBps, fmtHealthFactor, getHealthFactorState } from '@/lib/utils';
import { formatUnits, type Address } from 'viem';

/** Pool oracle base currency is 8 decimals on the Sodax fork. */
const BASE_CURRENCY_DECIMALS = 8;
/** Below this a leg rounds to nothing worth showing. Matches the close control's own dust bound. */
const DUST_BASE = 0.01;

function fmtBase(value: bigint): string {
  return Number(formatUnits(value, BASE_CURRENCY_DECIMALS)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function PositionRow({
  chain,
  position,
  owner,
  hidden,
  onEmptyChange,
}: {
  chain: SpokeChainKey;
  position: Address;
  owner: Address | undefined;
  /** Collapse this row when it is empty. The parent owns the toggle; the row owns the verdict. */
  hidden: boolean;
  onEmptyChange: (position: Address, isEmpty: boolean) => void;
}) {
  const { data: account, isLoading, error } = useLeveragePositionAccount({ params: { position } });
  const { data: info } = useLeveragePositionInfo({ params: { position } });
  const { data: slot } = useLeveragePositionPending({ params: { position } });

  /**
   * Empty means "nothing here and nothing owed and nothing in flight" — a closed position, which stays
   * in `positionsOf` forever because the registry is append-only.
   *
   * THE PENDING CHECK IS NOT OPTIONAL. A debt-side open before its fill has zero collateral AND zero
   * debt while the position is holding the user's contribution as a plain balance — collapsing that
   * would hide real money behind a toggle. Any occupied slot, live or awaiting settle, keeps the row
   * visible. A settled position has already had its idle balance swept, so by then empty is really empty.
   */
  const isEmpty =
    !!account &&
    Number(formatUnits(account.totalCollateralBase, BASE_CURRENCY_DECIMALS)) < DUST_BASE &&
    Number(formatUnits(account.totalDebtBase, BASE_CURRENCY_DECIMALS)) < DUST_BASE &&
    !slot?.isLive &&
    !slot?.needsSettle;

  React.useEffect(() => {
    onEmptyChange(position, isEmpty);
  }, [position, isEmpty, onEmptyChange]);

  if (isEmpty && hidden) return null;
  // getHealthFactorState takes a plain number; the value is only compared against thresholds,
  // so precision loss on the no-debt sentinel is immaterial.
  const health = account ? getHealthFactorState(Number(formatUnits(account.healthFactor, 18))) : undefined;

  return (
    <div className="rounded-md border p-3 space-y-1">
      <div className="font-mono text-xs break-all">
        {position}
        {isEmpty && <span className="ml-2 text-muted-foreground">(closed)</span>}
      </div>
      {isLoading && <div className="text-xs text-muted-foreground">loading account…</div>}
      {error && <div className="text-xs text-negative break-all">{error.message}</div>}
      {account && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">collateral</span>
          <span className="text-right font-mono text-xs">{fmtBase(account.totalCollateralBase)}</span>
          <span className="text-muted-foreground">debt</span>
          <span className="text-right font-mono text-xs">{fmtBase(account.totalDebtBase)}</span>
          <span className="text-muted-foreground">ltv (liq. threshold)</span>
          <span className="text-right font-mono text-xs">
            {fmtBps(account.ltv)} ({fmtBps(account.currentLiquidationThreshold)})
          </span>
          <span className="text-muted-foreground">health factor</span>
          <span className={`text-right font-mono text-xs ${health?.className ?? ''}`}>
            {fmtHealthFactor(account.healthFactor)}
            {health && <span className="ml-1 text-muted-foreground">({health.label})</span>}
          </span>
        </div>
      )}
      {/* Shown whenever the slot is occupied, not only while the intent is live — a
          resolved-but-unswept position is precisely the state that needs settling, and it would
          otherwise be invisible. */}
      {(slot?.isLive || slot?.needsSettle) && (
        <PendingOperationControl
          chain={chain}
          position={position}
          owner={owner}
          slot={slot}
          collateralToken={info?.collateral}
          borrowToken={info?.borrowToken}
        />
      )}
      {account && info && (
        <>
          <AdjustLeverageControl
            chain={chain}
            position={position}
            account={account}
            collateralToken={info.collateral}
            borrowToken={info.borrowToken}
            owner={owner}
            pending={!!slot?.isLive}
          />
          <ClosePositionControl
            chain={chain}
            position={position}
            account={account}
            collateralToken={info.collateral}
            borrowToken={info.borrowToken}
            owner={owner}
            pending={!!slot?.isLive}
          />
        </>
      )}
    </div>
  );
}

export function LeveragePositionsPanel({
  chain,
  spokeAddress,
  owner,
}: {
  chain: SpokeChainKey;
  spokeAddress: string | undefined;
  owner: Address | undefined;
}) {
  // Discovery goes through the spoke address, which resolves the hub wallet that owns the
  // positions — a raw EOA owns none of them.
  const {
    data: positions,
    isLoading,
    error,
  } = useLeveragePositionsForUser({ params: { spokeChainKey: chain, spokeAddress } });

  // Closed positions are never removed from the factory's registry, so without this the list only ever
  // grows. Hidden by default, with a count, and revealable — a filter you cannot switch off is a way to
  // lose track of something.
  const [showEmpty, setShowEmpty] = useState(false);
  const [empties, setEmpties] = useState<Record<string, boolean>>({});
  const onEmptyChange = useCallback((position: Address, isEmpty: boolean) => {
    setEmpties(prev => (prev[position] === isEmpty ? prev : { ...prev, [position]: isEmpty }));
  }, []);
  const emptyCount = (positions ?? []).filter(p => empties[p]).length;
  const activeCount = (positions ?? []).length - emptyCount;

  return (
    <Card className="w-full max-w-xl mx-auto">
      <CardHeader>
        <CardTitle className="text-lg font-bold">Leverage Positions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!spokeAddress && <div className="text-sm text-muted-foreground">Connect a wallet to list positions.</div>}
        {spokeAddress && isLoading && <div className="text-sm text-muted-foreground">loading positions…</div>}
        {spokeAddress && error && (
          <div className="space-y-1">
            <div className="text-sm text-negative break-all">{error.message}</div>
            <div className="text-xs text-muted-foreground">
              Positions need <code>leverageYield.positionFactory</code> in the Sodax config — the SDK fails closed here
              rather than guessing an address.
            </div>
          </div>
        )}
        {spokeAddress && positions && positions.length === 0 && (
          <div className="text-sm text-muted-foreground">No positions for this address.</div>
        )}
        {positions && positions.length > 0 && (activeCount === 0 || emptyCount > 0) && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {activeCount} open{emptyCount > 0 && `, ${emptyCount} closed`}
            </span>
            {emptyCount > 0 && (
              <Button size="sm" variant="outline" onClick={() => setShowEmpty(v => !v)}>
                <span className="text-[10px]">{showEmpty ? 'Hide closed' : `Show closed (${emptyCount})`}</span>
              </Button>
            )}
          </div>
        )}
        {positions?.map(p => (
          <PositionRow
            key={p}
            chain={chain}
            position={p}
            owner={owner}
            hidden={!showEmpty}
            onEmptyChange={onEmptyChange}
          />
        ))}
      </CardContent>
    </Card>
  );
}
