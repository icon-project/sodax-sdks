/**
 * The flows this app has a form for. Only `swap` is routed today — `bridge` is parked (see
 * `views/BridgeView.tsx`), and it stays in the union so a link written against it still resolves
 * to "not this flow" rather than seeding the swap with a bridge's chains.
 */
export const FLOWS = ['swap', 'bridge'] as const;

export type Flow = (typeof FLOWS)[number];

export function flowParam(value: string | null): Flow | undefined {
  return FLOWS.find(flow => flow === value);
}
