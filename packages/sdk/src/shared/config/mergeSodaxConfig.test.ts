/**
 * Tests for mergeSodaxConfig — the config-aware layering used by both `new Sodax(...)` and
 * ConfigService.initialize().
 *
 * The contract: every field deep-merges, so a partial override keeps untouched siblings. Each
 * feature exposes an optional `partnerFee` override slot (`swaps` / `moneyMarket` / `bridge` /
 * `leverageYield`). These slots are `SodaxOptions`/feature-options fields, NOT part of
 * `SodaxDefaultConfig` or the backend dynamic config, so a `partnerFee` never travels on the wire
 * and the base config never carries one. Every override therefore lands on an empty slot, and a
 * complete `PartnerFee` is written wholesale — no partial-variant hybrid (`{address, amount, percentage}`)
 * can arise from merging two different variants, because there is no base variant to merge against.
 *
 * (The global `fee` is NOT part of SodaxConfig merging — it is a `SodaxOptions` client option held by
 * ConfigService, never merged here.)
 *
 * We keep calculateFeeAmount as an oracle on the fee-applied cases: it proves the merged config
 * charges exactly the user's intended fee, not just that the structural shape matches.
 */
import { describe, expect, it } from 'vitest';
import { sodaxConfig, type PartnerFee, type SodaxConfig, type SodaxOptions } from '@sodax/types';
import { mergeSodaxConfig } from './mergeSodaxConfig.js';
import { calculateFeeAmount } from '../utils/shared-utils.js';

const USER_ADDR = '0x1111111111111111111111111111111111111111';
const INPUT = 1_000_000n;

function freshConfig(): SodaxConfig {
  return structuredClone(sodaxConfig) as SodaxConfig;
}

type FeeField = {
  name: string;
  get: (cfg: SodaxConfig) => PartnerFee | undefined;
  override: (fee: PartnerFee) => SodaxOptions;
  // Distinct percentage variant per feature so a cross-feature leak would change the charged amount.
  userFee: PartnerFee;
  // A static default sibling that must survive a partnerFee-only override. Bridge has none
  // (BridgeDefaultConfig is `{}`), so the sibling case is skipped for it.
  sibling?: { name: string; get: (cfg: SodaxConfig) => unknown };
};

const FEE_FIELDS: FeeField[] = [
  {
    name: 'swaps.partnerFee',
    get: cfg => cfg.swaps.partnerFee,
    override: fee => ({ swaps: { partnerFee: fee } }),
    userFee: { address: USER_ADDR, percentage: 25 },
    sibling: { name: 'swaps.supportedTokens', get: cfg => cfg.swaps.supportedTokens },
  },
  {
    name: 'moneyMarket.partnerFee',
    get: cfg => cfg.moneyMarket.partnerFee,
    override: fee => ({ moneyMarket: { partnerFee: fee } }),
    userFee: { address: USER_ADDR, percentage: 50 },
    sibling: { name: 'moneyMarket.lendingPool', get: cfg => cfg.moneyMarket.lendingPool },
  },
  {
    name: 'bridge.partnerFee',
    get: cfg => cfg.bridge.partnerFee,
    override: fee => ({ bridge: { partnerFee: fee } }),
    userFee: { address: USER_ADDR, percentage: 75 },
  },
  {
    name: 'leverageYield.partnerFee',
    get: cfg => cfg.leverageYield.partnerFee,
    override: fee => ({ leverageYield: { partnerFee: fee } }),
    userFee: { address: USER_ADDR, percentage: 100 },
    sibling: { name: 'leverageYield.vaults', get: cfg => cfg.leverageYield.vaults },
  },
];

describe.each(FEE_FIELDS)('mergeSodaxConfig — $name override', field => {
  it('applies the user fee onto a base with no partnerFee (constructor scenario)', () => {
    const base = freshConfig(); // production default: no partnerFee on this feature
    expect(field.get(base)).toBeUndefined();

    const merged = mergeSodaxConfig(base, field.override(field.userFee));

    expect(field.get(merged)).toEqual(field.userFee);
    // Oracle: the merged config charges exactly the user's intended fee.
    expect(calculateFeeAmount(INPUT, field.get(merged))).toBe(calculateFeeAmount(INPUT, field.userFee));
  });

  it('re-layers the user fee onto a remote default with no partnerFee (ConfigService.initialize path)', () => {
    // The dynamic SodaxDefaultConfig fetched in ConfigService.initialize carries no per-feature
    // partnerFee — it never travels on the wire — so this is the same empty-slot merge as the
    // constructor, exercised explicitly as the initialize re-layer path.
    const base = freshConfig();

    const merged = mergeSodaxConfig(base, field.override(field.userFee));

    expect(field.get(merged)).toEqual(field.userFee);
  });

  it('leaves the feature without a partnerFee when the override omits it', () => {
    const base = freshConfig();

    const merged = mergeSodaxConfig(base, { api: { timeout: 12_345 } });

    // Treat an explicit `undefined` slot the same as an absent one.
    expect(field.get(merged)).toBeUndefined();
  });

  const siblingCase = field.sibling;
  if (siblingCase) {
    it(`preserves ${siblingCase.name} when only partnerFee is overridden`, () => {
      const base = freshConfig();
      const originalSibling = siblingCase.get(base);

      const merged = mergeSodaxConfig(base, field.override(field.userFee));

      // deepMerge keeps untouched nested refs, so the sibling survives by reference on the merged config.
      expect(siblingCase.get(merged)).toBe(originalSibling);
      // base must not be mutated by the merge.
      expect(siblingCase.get(base)).toBe(originalSibling);
    });
  }
});

describe('mergeSodaxConfig — non-union fields still deep-merge', () => {
  it('overrides a nested scalar while preserving its siblings', () => {
    const base = freshConfig();
    const originalBaseUrl = base.api.baseURL;

    const merged = mergeSodaxConfig(base, { api: { timeout: 99_999 } });

    expect(merged.api.timeout).toBe(99_999); // overridden
    expect(merged.api.baseURL).toBe(originalBaseUrl); // sibling preserved
    expect(base.api.timeout).not.toBe(99_999); // base not mutated
  });
});
