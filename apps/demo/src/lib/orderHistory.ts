import type { Order } from '@/components/swaps/OrderStatus';
import { readJson, writeJson } from '@/lib/storage';

// Persists the recent solver swap history so in-flight swaps survive a refresh: each card
// re-loads its own status from the stored hash (and caches the terminal result), so a swap
// that settles while the app is closed still shows complete. Orders are JSON-safe scalars.

const STORAGE_KEY = 'sodax-demo:solver:orders';

/** Keep at most the newest N swaps; a 16th evicts the oldest. */
export const MAX_ORDERS = 15;

function isOrder(value: unknown): value is Order {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const o = value as Record<string, unknown>;
  if (!o.summary || typeof o.summary !== 'object') {
    return false;
  }
  if (o.mode === 'solver') {
    return typeof o.intentHash === 'string' && typeof o.dstTxHash === 'string' && typeof o.orderId === 'string';
  }
  if (o.mode === 'submit-tx') {
    return typeof o.txHash === 'string' && typeof o.srcChainKey === 'string';
  }
  return false;
}

export function loadOrders(): Order[] {
  const parsed = readJson<unknown[]>(STORAGE_KEY);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isOrder).slice(-MAX_ORDERS);
}

export function saveOrders(orders: Order[]): void {
  writeJson(STORAGE_KEY, orders.slice(-MAX_ORDERS));
}
