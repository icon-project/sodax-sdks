/**
 * Tests for mergeSodaxConfig — the config-aware layering used by both `new Sodax(...)` and
 * ConfigService.initialize().
 *
 * The contract: most fields deep-merge (a partial override keeps untouched siblings), but the two
 * `PartnerFee`-typed fields (`fee`, `bridge.partnerFee`) are ATOMIC. `PartnerFee` is a discriminated
 * union (`{address, amount}` | `{address, percentage}`); a naive deep-merge of two different variants
 * produces an invalid hybrid `{address, amount, percentage}`. Downstream discrimination treats any
 * object with a bigint `amount` as the amount variant (calculateFeeAmount → isPartnerFeeAmount), so the
 * hybrid silently mis-charges the fee. mergeSodaxConfig must replace these fields wholesale instead.
 *
 * We use calculateFeeAmount as the oracle: each variant yields a DISTINCT charged amount for the same
 * input, so the assertion proves which variant/value actually won — not just structural shape.
 */
import { describe, expect, it } from 'vitest';
import { sodaxConfig, type DeepPartial, type PartnerFee, type SodaxConfig } from '@sodax/types';
import { mergeSodaxConfig } from './mergeSodaxConfig.js';
import { calculateFeeAmount } from '../utils/shared-utils.js';

const USER_ADDR = '0x1111111111111111111111111111111111111111';
const REMOTE_ADDR = '0x9999999999999999999999999999999999999999';
const INPUT = 1_000_000n;

type Variant = 'amount' | 'percentage';

// Distinct values per side & variant so calculateFeeAmount disambiguates exactly which one survived.
// amount → charged as-is; percentage → INPUT * pct / 10000n.
function userFee(v: Variant): PartnerFee {
  return v === 'amount' ? { address: USER_ADDR, amount: 50n } : { address: USER_ADDR, percentage: 100 };
}
function remoteFee(v: Variant): PartnerFee {
  return v === 'amount' ? { address: REMOTE_ADDR, amount: 7n } : { address: REMOTE_ADDR, percentage: 1 };
}

function freshConfig(): SodaxConfig {
  return structuredClone(sodaxConfig) as SodaxConfig;
}

type FeeField = {
  name: string;
  set: (cfg: SodaxConfig, fee: PartnerFee | undefined) => void;
  get: (cfg: SodaxConfig) => PartnerFee | undefined;
  override: (fee: PartnerFee) => DeepPartial<SodaxConfig>;
};

const FEE_FIELDS: FeeField[] = [
  {
    name: 'fee',
    set: (cfg, fee) => {
      cfg.fee = fee;
    },
    get: cfg => cfg.fee,
    override: fee => ({ fee }),
  },
  {
    name: 'bridge.partnerFee',
    set: (cfg, fee) => {
      cfg.bridge.partnerFee = fee;
    },
    get: cfg => cfg.bridge.partnerFee,
    override: fee => ({ bridge: { partnerFee: fee } }),
  },
];

const VARIANTS: Variant[] = ['amount', 'percentage'];
const COMBINATIONS = VARIANTS.flatMap(remoteV => VARIANTS.map(userV => ({ remoteV, userV })));

describe.each(FEE_FIELDS)('mergeSodaxConfig — $name is atomic across PartnerFee variants', field => {
  it.each(COMBINATIONS)('remote=$remoteV, user=$userV → user override wins, no hybrid', ({ remoteV, userV }) => {
    const base = freshConfig();
    field.set(base, remoteFee(remoteV));
    const user = userFee(userV);

    const merged = mergeSodaxConfig(base, field.override(user));
    const mergedFee = field.get(merged) as PartnerFee;

    // Atomic replacement: exactly the user's variant, no leftover key from the remote variant.
    expect(mergedFee).toEqual(user);
    // Oracle: the charged fee matches the user's intent, not a hybrid mis-read.
    expect(calculateFeeAmount(INPUT, mergedFee)).toBe(calculateFeeAmount(INPUT, user));
    // base must not be mutated by the wholesale assignment.
    expect(field.get(base)).toEqual(remoteFee(remoteV));
  });

  it('assigns the override wholesale when the base field is undefined (constructor scenario)', () => {
    const base = freshConfig();
    field.set(base, undefined);
    const user = userFee('percentage');

    const merged = mergeSodaxConfig(base, field.override(user));

    expect(field.get(merged)).toEqual(user);
  });

  it('keeps the base fee when the override omits it', () => {
    const base = freshConfig();
    field.set(base, remoteFee('amount'));

    const merged = mergeSodaxConfig(base, { api: { timeout: 12_345 } });

    expect(field.get(merged)).toEqual(remoteFee('amount'));
  });
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
