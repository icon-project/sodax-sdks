import type { DeepPartial, PartnerFee, SodaxConfig } from '@sodax/types';
import { deepMerge } from '../utils/deepMerge.js';

/**
 * Layers a user `DeepPartial<SodaxConfig>` override on top of a full base config (the static default in the
 * Sodax constructor, or the dynamic config in {@link ConfigService.initialize}).
 *
 * Most fields are deep-merged, so a user can override `api.timeout` without dropping the sibling `api.baseURL`.
 * `PartnerFee` is the exception: it is a discriminated union (`{address, amount}` | `{address, percentage}`),
 * so deep-merging a percentage override onto an amount base (or vice versa) would yield an invalid hybrid
 * carrying both keys. Downstream discrimination treats any object with a bigint `amount` as the amount
 * variant (see `isPartnerFeeAmount` / `calculateFeeAmount`), so such a hybrid silently mis-charges the fee.
 * The two `PartnerFee`-typed config fields are therefore atomic — the override replaces the base value
 * wholesale, which means a fee override must be a complete `PartnerFee`, not a partial.
 */
export function mergeSodaxConfig(base: SodaxConfig, override: DeepPartial<SodaxConfig>): SodaxConfig {
  const merged = deepMerge<SodaxConfig>(base, override);
  if (override.fee !== undefined) {
    merged.fee = override.fee as PartnerFee;
  }
  if (override.bridge?.partnerFee !== undefined) {
    merged.bridge.partnerFee = override.bridge.partnerFee as PartnerFee;
  }
  return merged;
}
