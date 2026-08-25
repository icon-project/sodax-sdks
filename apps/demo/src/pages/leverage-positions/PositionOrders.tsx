/**
 * Order history for position intents, on the demo's standard rails.
 *
 * Every leverage operation is a solver intent, which is what `OrderStatusPanel` already renders for
 * the swap and leverage-yield pages: it polls `/status` from the stored hub tx hash against the
 * endpoint of the environment the order was created on, and snapshots the outcome into `final` once
 * it can no longer change. Reusing it rather than reporting status inline matters beyond consistency
 * — `OrderStatus` treats `NOT_FOUND` as transient (the solver may not have indexed the intent yet),
 * whereas describing it inline invited stating it as fact.
 *
 * The provider exists because the controls that post intents are nested inside the positions list,
 * and threading a recorder down three levels of props to reach them is worse than a context.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import OrderStatusPanel from '@/components/swaps/OrderStatusPanel';
import { buildOrderSummary, orderId, type FinalStatus, type Order } from '@/components/swaps/OrderStatus';
import { LEVERAGE_POSITIONS_ORDERS_KEY, appendOrder, loadOrders, saveOrders } from '@/lib/orderHistory';
import { LEVERAGE_POSITIONS_PANEL_KEY } from '@/lib/panelPrefs';
import { solverApiEndpointForEnv } from '@/constants';
import { useAppStore } from '@/zustand/useAppStore';

export type RecordIntentParams = {
  /** Hub tx the intent was posted in — what `/status` is polled with. */
  txHash: string;
  /** Solver's acknowledgement, when it accepted the intent. */
  intentHash?: string;
  /** What is being given up and what is expected back, for the summary line. */
  from: { amount: string; symbol: string };
  to: { symbol: string; decimals: number; quoted?: bigint };
};

const RecordContext = createContext<((params: RecordIntentParams) => void) | undefined>(undefined);

/** Records a posted intent in the page's order history. No-op outside the provider. */
export function useRecordPositionOrder(): (params: RecordIntentParams) => void {
  return useContext(RecordContext) ?? (() => undefined);
}

export function PositionOrdersProvider({ children }: { children: React.ReactNode }) {
  const { solverEnvironment } = useAppStore();
  const [orders, setOrders] = useState<Order[]>(() => loadOrders(LEVERAGE_POSITIONS_ORDERS_KEY));

  // Loaded after mount rather than in the initial state, since localStorage is not available during
  // SSR and the panel is purely a client concern.
  // Loaded lazily rather than in a mount effect: with the load in an effect, the sibling save effect
  // fires first on the initial commit and writes the still-empty array over the stored one, which
  // StrictMode's effect replay then reads back as empty. Persisted in-flight orders — and the hashes
  // needed to keep tracking them — were erased by opening the page.
  useEffect(() => saveOrders(LEVERAGE_POSITIONS_ORDERS_KEY, orders), [orders]);

  const record = useCallback(
    ({ txHash, intentHash, from, to }: RecordIntentParams) => {
      setOrders(prev =>
        appendOrder(prev, {
          mode: 'solver',
          intentHash: intentHash ?? txHash,
          orderId: txHash,
          dstTxHash: txHash,
          srcTxHash: txHash,
          srcChainKey: 'sonic',
          // Pinned per order: switching environment later must not repoint an existing order's polling.
          statusEndpoint: solverApiEndpointForEnv(solverEnvironment),
          createdAt: Date.now(),
          summary: buildOrderSummary(
            { chain: 'sonic', token: { symbol: from.symbol } },
            { chain: 'sonic', token: { symbol: to.symbol, decimals: to.decimals } },
            from.amount,
            to.quoted,
          ),
        }),
      );
    },
    [solverEnvironment],
  );

  const onDismiss = useCallback((id: string) => setOrders(prev => prev.filter(o => orderId(o) !== id)), []);
  const onSettle = useCallback(
    (id: string, final: FinalStatus) => setOrders(prev => prev.map(o => (orderId(o) === id ? { ...o, final } : o))),
    [],
  );

  const value = useMemo(() => record, [record]);

  return (
    <RecordContext.Provider value={value}>
      {children}
      {orders.length > 0 && (
        <div className="w-full max-w-xl mx-auto">
          <OrderStatusPanel
            orders={orders}
            onDismiss={onDismiss}
            onSettle={onSettle}
            storageKey={LEVERAGE_POSITIONS_PANEL_KEY}
          />
        </div>
      )}
    </RecordContext.Provider>
  );
}
