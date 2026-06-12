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
import {
  DEFAULT_BACKEND_API_ENDPOINT,
  DEFAULT_BACKEND_API_HEADERS,
  DEFAULT_BACKEND_API_TIMEOUT,
  sodaxConfig,
  type DeepPartial,
  type PartnerFee,
  type SodaxConfig,
} from '@sodax/types';
import { mergeSodaxConfig } from './mergeSodaxConfig.js';
import { calculateFeeAmount } from '../utils/shared-utils.js';
import { resolveBaseApiConfig, resolveSwapsApiConfig } from '../../backendApi/apiConfig.js';

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
    const originalBaseUrl = (base.api as { baseURL: string }).baseURL;

    const merged = mergeSodaxConfig(base, { api: { timeout: 99_999 } });

    expect((merged.api as { timeout: number }).timeout).toBe(99_999); // overridden
    expect((merged.api as { baseURL: string }).baseURL).toBe(originalBaseUrl); // sibling preserved
    expect((base.api as { timeout: number }).timeout).not.toBe(99_999); // base not mutated
  });
});

// `api` is the `ApiConfig` union (`BaseApiConfig | CustomApiConfig`). mergeSodaxConfig must
// produce an `api` value that the per-service resolvers reduce to the correct base/swaps
// endpoints — for BOTH variants and partial overrides. The resolvers are the oracle here
// (mirrors how the PartnerFee tests use calculateFeeAmount): they prove which values actually
// reach BackendApiService (base) and SwapsApiService (swaps), independent of the merged shape.
describe('mergeSodaxConfig — api ApiConfig union resolves correctly per service', () => {
  const D = DEFAULT_BACKEND_API_HEADERS;
  const DEFAULT_RESOLVED = {
    baseURL: DEFAULT_BACKEND_API_ENDPOINT,
    timeout: DEFAULT_BACKEND_API_TIMEOUT,
    headers: { ...D },
  };

  const resolveBoth = (override: DeepPartial<SodaxConfig>) => {
    const merged = mergeSodaxConfig(freshConfig(), override);
    return { base: resolveBaseApiConfig(merged.api), swaps: resolveSwapsApiConfig(merged.api), mergedApi: merged.api };
  };

  it('no override → base and swaps both use the defaults', () => {
    const { base, swaps } = resolveBoth({});
    expect(base).toEqual(DEFAULT_RESOLVED);
    expect(swaps).toEqual(DEFAULT_RESOLVED);
  });

  it('flat partial override (timeout) → applied to both, sibling baseURL preserved', () => {
    const { base, swaps } = resolveBoth({ api: { timeout: 99_999 } });
    const expected = { baseURL: DEFAULT_BACKEND_API_ENDPOINT, timeout: 99_999, headers: { ...D } };
    expect(base).toEqual(expected);
    expect(swaps).toEqual(expected);
  });

  it('flat full override → applied to both (swaps shares the base)', () => {
    const { base, swaps } = resolveBoth({
      api: { baseURL: 'https://flat.example', timeout: 7, headers: { 'X-A': '1' } },
    });
    const expected = { baseURL: 'https://flat.example', timeout: 7, headers: { ...D, 'X-A': '1' } };
    expect(base).toEqual(expected);
    expect(swaps).toEqual(expected);
  });

  it('CustomApiConfig with swapsApiConfig only → base = defaults, swaps = custom (slice not dropped by merge)', () => {
    const { base, swaps, mergedApi } = resolveBoth({
      api: { swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 2, headers: { 'X-S': '1' } } },
    });
    expect(base).toEqual(DEFAULT_RESOLVED);
    expect(swaps).toEqual({ baseURL: 'https://swaps.example', timeout: 2, headers: { ...D, 'X-S': '1' } });
    // the deep-merge must carry the override's custom slice through verbatim
    expect((mergedApi as { swapsApiConfig?: unknown }).swapsApiConfig).toEqual({
      baseURL: 'https://swaps.example',
      timeout: 2,
      headers: { 'X-S': '1' },
    });
  });

  it('CustomApiConfig with baseApiConfig only → base = custom, swaps falls back to it', () => {
    const { base, swaps } = resolveBoth({
      api: { baseApiConfig: { baseURL: 'https://base.example', timeout: 3, headers: { 'X-B': '1' } } },
    });
    const expected = { baseURL: 'https://base.example', timeout: 3, headers: { ...D, 'X-B': '1' } };
    expect(base).toEqual(expected);
    expect(swaps).toEqual(expected);
  });

  it('CustomApiConfig with both slices → swaps overrides baseURL/timeout, headers layer base under swaps', () => {
    const { base, swaps } = resolveBoth({
      api: {
        baseApiConfig: { baseURL: 'https://base.example', timeout: 3, headers: { 'X-B': '1' } },
        swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 2, headers: { 'X-S': '1' } },
      },
    });
    expect(base).toEqual({ baseURL: 'https://base.example', timeout: 3, headers: { ...D, 'X-B': '1' } });
    // swaps overrides baseURL/timeout; headers merge defaults → base → swaps (base 'X-B' inherited)
    expect(swaps).toEqual({ baseURL: 'https://swaps.example', timeout: 2, headers: { ...D, 'X-B': '1', 'X-S': '1' } });
  });

  it('CustomApiConfig: swaps inherits a baseApiConfig header (auth) it does not override', () => {
    const { base, swaps } = resolveBoth({
      api: {
        baseApiConfig: { baseURL: 'https://base.example', timeout: 3, headers: { Authorization: 'tok' } },
        swapsApiConfig: { headers: { 'X-Swaps': '1' } },
      },
    });
    expect(base).toEqual({ baseURL: 'https://base.example', timeout: 3, headers: { ...D, Authorization: 'tok' } });
    // swaps inherits base's baseURL/timeout/Authorization, plus its own header
    expect(swaps).toEqual({
      baseURL: 'https://base.example',
      timeout: 3,
      headers: { ...D, Authorization: 'tok', 'X-Swaps': '1' },
    });
  });

  it('does not mutate the base config when merging a CustomApiConfig override', () => {
    const base = freshConfig();
    const before = structuredClone(base.api);
    mergeSodaxConfig(base, {
      api: { swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 2, headers: {} } },
    });
    expect(base.api).toEqual(before);
  });
});
