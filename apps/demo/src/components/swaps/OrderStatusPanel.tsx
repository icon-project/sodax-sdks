import React from 'react';
import OrderStatus, { orderId, type FinalStatus, type Order } from '@/components/swaps/OrderStatus';

// Lists every in-flight swap — newest on top, each updating in realtime via its own OrderStatus
// hooks. Responsive: below the form in normal flow until xl, where there is finally room beside a
// window-centered form for a fixed left sidebar (docked under the header, scrolls internally).
export default function OrderStatusPanel({
  orders,
  onDismiss,
  onSettle,
}: {
  orders: Order[];
  onDismiss: (id: string) => void;
  onSettle: (id: string, final: FinalStatus) => void;
}) {
  if (orders.length === 0) {
    return null;
  }

  // Newest order first (orders are appended as swaps fire).
  const newestFirst = [...orders].reverse();

  return (
    <aside className="thin-scrollbar flex w-full max-w-lg flex-col gap-3 xl:fixed xl:left-4 xl:top-24 xl:z-40 xl:max-h-[calc(100vh-7rem)] xl:w-[23rem] xl:max-w-none xl:overflow-y-auto xl:p-2 2xl:w-[26rem]">
      <div className="flex items-center gap-2 px-1">
        <span className="text-sm font-semibold text-cherry-dark">Swaps</span>
        <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-cherry-soda px-1.5 text-xs font-semibold text-white">
          {orders.length}
        </span>
      </div>
      {newestFirst.map(order => {
        const id = orderId(order);
        return <OrderStatus key={id} order={order} onDismiss={() => onDismiss(id)} onSettle={onSettle} />;
      })}
    </aside>
  );
}
