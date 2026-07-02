import React, { useState } from 'react';
import SwapCard from '@/components/swaps-api/SwapCard';
import OrderStatus, { type SwapsApiOrder } from '@/components/swaps-api/OrderStatus';

export default function SwapsApiPage() {
  const [orders, setOrders] = useState<SwapsApiOrder[]>([]);

  return (
    <main className="flex flex-col items-center content-center justify-center space-y-2">
      {orders.map((order, index) => (
        <OrderStatus key={`${order.txHash}-${index}`} order={order} />
      ))}

      <SwapCard setOrders={setOrders} />
    </main>
  );
}
