import React, { useCallback, useEffect, useState } from 'react';
import SwapCard from '@/components/swaps/SwapCard';
import LimitOrderCard from '@/components/swaps/LimitOrderCard';
import { type FinalStatus, type Order, orderId } from '@/components/swaps/OrderStatus';
import OrderStatusPanel from '@/components/swaps/OrderStatusPanel';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SolverEnv, useAppStore } from '@/zustand/useAppStore';
import { loadOrders, saveOrders, SOLVER_ORDERS_KEY } from '@/lib/orderHistory';

enum OrderType {
  Market = 'Market',
  Limit = 'Limit',
}

export default function SolverPage() {
  const { solverEnvironment, setSolverEnvironment } = useAppStore();
  const [orders, setOrders] = useState<Order[]>(() => loadOrders(SOLVER_ORDERS_KEY));

  // Persist swap history so in-flight swaps survive a refresh and still show on completion.
  useEffect(() => {
    saveOrders(SOLVER_ORDERS_KEY, orders);
  }, [orders]);

  const [orderType, setOrderType] = useState<OrderType>(OrderType.Market);

  const handleDismissOrder = (id: string) => {
    setOrders(prev => prev.filter(order => orderId(order) !== id));
  };

  // Snapshot a swap's terminal status so a reload renders it statically (no polling/fetch).
  // onSettle only fires from a live card that just reached a terminal status, so overwrite
  // unconditionally — this also heals an order stale-cached as non-terminal (e.g. NOT_FOUND).
  const handleSettleOrder = useCallback((id: string, final: FinalStatus) => {
    setOrders(prev => prev.map(order => (orderId(order) === id ? { ...order, final } : order)));
  }, []);

  return (
    <main className="flex flex-col items-center content-center justify-center space-y-2">
      <Tabs value={solverEnvironment} onValueChange={value => setSolverEnvironment(value as SolverEnv)}>
        <TabsList>
          <TabsTrigger value={SolverEnv.Staging}>Staging</TabsTrigger>
          <TabsTrigger value={SolverEnv.Production}>Production</TabsTrigger>
          <TabsTrigger value={SolverEnv.Dev}>Dev</TabsTrigger>
        </TabsList>
      </Tabs>

      <Tabs
        value={orderType}
        onValueChange={value => {
          setOrderType(value as OrderType);
        }}
      >
        <TabsList>
          <TabsTrigger value={OrderType.Market}>Swap</TabsTrigger>
          <TabsTrigger value={OrderType.Limit}>Limit Order</TabsTrigger>
        </TabsList>
      </Tabs>

      {orderType === OrderType.Market && <SwapCard setOrders={setOrders} />}
      {orderType === OrderType.Limit && <LimitOrderCard />}

      {/* Below the form on small screens; a fixed left sidebar on lg+ (see OrderStatusPanel). */}
      <OrderStatusPanel orders={orders} onDismiss={handleDismissOrder} onSettle={handleSettleOrder} />
    </main>
  );
}
