/**
 * Pending-operation banner with a cancel.
 *
 * A position allows one intent at a time, so while something is in flight every other control is
 * unusable — that state needs to be visible rather than expressed only as disabled buttons. Cancel
 * is the escape hatch when no solver fills: it drops the grant the hook was given, cancels the
 * intent, and returns anything the position is holding loose to the owner. A position carrying no
 * debt also withdraws its whole collateral balance back, which is what a leveraged open whose intent
 * never filled needs.
 *
 * Cancelling before the deadline is allowed and is the owner's call to make. After the deadline the
 * intent is cancellable by anyone, which resolves the intent without the position being told — so the
 * slot stays occupied until someone settles. Nothing notifies it; that is what `needsSettle` is for.
 *
 * Settle is also the second half of a close that exited into the debt token: the fill leaves the
 * surplus sitting in the position, and this sweep is what delivers it to the owner.
 */

import React, { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useSodaxContext, type LeveragePositionPendingState, type SpokeChainKey } from '@sodax/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { erc20Abi } from 'viem';
import type { Address } from 'viem';
import { getReadableTxError } from '@/lib/utils';
import { useHubWalletRoute } from './useHubWalletRoute';

export function PendingOperationControl({
  chain,
  position,
  owner,
  slot,
  collateralToken,
  borrowToken,
}: {
  chain: SpokeChainKey;
  position: Address;
  owner: Address | undefined;
  slot: LeveragePositionPendingState;
  collateralToken: Address | undefined;
  borrowToken: Address | undefined;
}) {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();
  const { route } = useHubWalletRoute(chain);

  /**
   * Whether settling would actually move anything. A close that delivered its surplus leaves the
   * position empty, so the slot is stale but there is nothing to recover — and the next operation
   * clears it anyway, because every one of them calls `_settlePending` first. Telling the user to settle
   * in that state invents a step.
   */
  const { data: idle } = useQuery({
    queryKey: ['leverageYield', 'positionIdle', position, collateralToken, borrowToken],
    enabled: !!collateralToken && !!borrowToken,
    refetchInterval: 15_000,
    queryFn: async (): Promise<bigint> => {
      const balances = await Promise.all(
        [collateralToken, borrowToken].map(t =>
          sodax.hubProvider.publicClient.readContract({
            address: t as Address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [position],
          }),
        ),
      );
      return balances.reduce((a, b) => a + b, 0n);
    },
  });
  const hasSomethingToRecover = (idle ?? 0n) > 0n;

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  /**
   * `settle()` rather than `cancel()`: the intent has already resolved, so there is nothing to
   * cancel — cancelling would revert IntentNotFound. This clears the stale slot, drops the grant and
   * sweeps any idle balance back to the owner. Permissionless, which is why it is offered even when
   * the viewer is not the owner.
   */
  const onSettle = useCallback(async () => {
    if (!owner) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const tx = sodax.leverageYield.buildSettlePosition({ from: owner, position });
      const { dstChainTxHash } = await route([tx]);
      setStatus(`Settled (${dstChainTxHash.slice(0, 10)}…) — anything held loose is back with the owner`);
      await queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
    } catch (e) {
      setError(getReadableTxError(e));
    } finally {
      setBusy(false);
    }
  }, [owner, sodax, position, route, queryClient]);

  const onCancel = useCallback(async () => {
    if (!owner) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const tx = sodax.leverageYield.buildCancelPositionOperation({ from: owner, position });
      const { dstChainTxHash } = await route([tx]);
      setStatus(`Cancelled (${dstChainTxHash.slice(0, 10)}…) — anything the position held loose is back with you`);
      await queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
    } catch (e) {
      setError(getReadableTxError(e));
    } finally {
      setBusy(false);
    }
  }, [owner, sodax, position, route, queryClient]);

  return (
    <div className="space-y-2 border-t pt-2">
      <div className="text-xs">
        {!slot.needsSettle
          ? 'An operation is in flight, so no other one is possible until it resolves. What the solver is doing with it is shown in the order list below.'
          : hasSomethingToRecover
            ? 'This operation has resolved but the position has not been told, so its grant is still open and it is still holding funds. Settle returns them to the owner.'
            : 'This operation has resolved and the position is holding nothing — a close that delivered its proceeds leaves it empty. Nothing to recover: settling only tidies the slot, and your next operation does that for you.'}
      </div>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          size="sm"
          variant="outline"
          disabled={busy || !owner || !slot.isLive}
          onClick={onCancel}
        >
          {busy ? 'Working…' : 'Cancel'}
        </Button>
        {/* Settling while the intent is still live reverts, so offering it is pure wallet friction. */}
        <Button
          className="flex-1"
          size="sm"
          variant="outline"
          disabled={busy || !owner || !slot.needsSettle}
          onClick={onSettle}
        >
          {busy ? 'Working…' : 'Settle'}
        </Button>
      </div>
      <div className="text-[10px] text-muted-foreground">
        Cancel ends an intent that is still live. Settle clears one that already resolved — worth doing when the solver
        reports failed or not-found AND the position is still holding something, since that is a contribution waiting to
        come back. Otherwise it is optional: every operation settles a stale slot before it starts.
      </div>
      {status && <div className="text-xs text-cherry-soda break-all">{status}</div>}
      {error && <div className="text-xs text-negative break-all">{error}</div>}
    </div>
  );
}
