import type { GaslessSponsorshipOptions } from '../GaslessTypes.js';

/**
 * Merge a per-request sponsorship override over a chain's resolved paymaster context.
 *
 * Precedence (highest first): request `paymasterContext` → request `sponsorshipPolicyId` (wrapped) →
 * `base` (the per-chain default already resolved by `resolveEndpoints`, itself
 * `chain.paymasterContext ?? { sponsorshipPolicyId }`). Returns `undefined` when nothing is set.
 */
export function resolvePaymasterContext(
  base: Record<string, unknown> | undefined,
  override: GaslessSponsorshipOptions | undefined,
): Record<string, unknown> | undefined {
  if (override?.paymasterContext) return override.paymasterContext;
  if (override?.sponsorshipPolicyId) return { sponsorshipPolicyId: override.sponsorshipPolicyId };
  return base;
}
