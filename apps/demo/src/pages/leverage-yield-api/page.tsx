import React, { useState } from 'react';
import LeverageCard from '@/components/leverage-yield-api/LeverageCard';
import OrderStatus, { type LeverageYieldApiOrder } from '@/components/leverage-yield-api/OrderStatus';

/**
 * Leverage Yield API v2 showcase — deposits/withdrawals driven entirely by the backend
 * `sodax.api.leverageYield.*` HTTP client (via `@sodax/dapp-kit` `useLeverageYieldApi*` hooks).
 * The only client-side steps are allowance signing, sign-and-broadcast, and minor utils — every
 * quote/intent/relay decision is made by the API. Mirrors the swaps-api page.
 */
export default function LeverageYieldApiPage() {
  const [orders, setOrders] = useState<LeverageYieldApiOrder[]>([]);

  return (
    <main className="flex flex-col items-center content-center justify-center space-y-2">
      {orders.map((order, index) => (
        <OrderStatus key={`${order.txHash}-${index}`} order={order} />
      ))}

      <LeverageCard setOrders={setOrders} />
    </main>
  );
}
