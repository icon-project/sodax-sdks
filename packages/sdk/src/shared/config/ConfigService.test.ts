/**
 * Tests for ConfigService.initialize() — the dynamic-config merge contract.
 *
 * The behavior under test: a successful remote-config fetch REPLACES the static defaults
 * (so chains/tokens can change without an SDK release), but it must NOT clobber the explicit
 * overrides the caller passed to `new Sodax(...)`. Those user overrides are re-layered on top
 * of the dynamic config via deepMerge.
 *
 * `bridge.partnerFee` is the representative user-overridable field here: every field deep-merges, and
 * a per-feature `partnerFee` is never sent by the backend (it is a client-side `SodaxOptions` field, not
 * part of the default-config data), so a user override always lands on an empty slot and merges cleanly.
 *
 * The GLOBAL partner `fee` is NOT part of SodaxConfig — it is a client-side `SodaxOptions` option
 * held by ConfigService (like `logger`), never fetched or overwritten. Its own describe block covers that.
 *
 * Each test constructs a real ConfigService backed by a fake BackendApiService whose
 * `getAllConfig` resolves to a scripted Result. The wiring mirrors Sodax exactly:
 *   - `config`     = deepMerge(sodaxConfig, userOverride)  (the merged instanceConfig)
 *   - `userConfig` = the raw partial override
 *   - `fee`        = the resolved client-side global fee option
 */
import { describe, expect, it, vi } from 'vitest';
import {
  sodaxConfig,
  CONFIG_VERSION,
  type SodaxConfig,
  type Result,
  type GetAllConfigApiResponse,
  type PartnerFee,
  type SodaxOptions,
} from '@sodax/types';
import { ConfigService } from './ConfigService.js';
import { deepMerge } from '../utils/deepMerge.js';
import type { BackendApiService } from '../../backendApi/BackendApiService.js';

function makeService(
  userConfig: SodaxOptions | undefined,
  response: Result<GetAllConfigApiResponse>,
  fee?: PartnerFee,
) {
  const getAllConfig = vi.fn().mockResolvedValue(response);
  const api = { getAllConfig } as unknown as BackendApiService;
  const config = userConfig ? deepMerge<SodaxConfig>(sodaxConfig, userConfig) : sodaxConfig;
  const service = new ConfigService({ api, config, userConfig, fee });
  return { service, getAllConfig };
}

const USER_FEE: PartnerFee = { address: '0x1111111111111111111111111111111111111111', percentage: 123 };
const REMOTE_FEE: PartnerFee = { address: '0x9999999999999999999999999999999999999999', percentage: 1 };

/** A full, valid SodaxConfig cloned from the default so loadSodaxConfigDataStructures has real data. */
function remoteConfig(mutate?: (cfg: SodaxConfig) => void): SodaxConfig {
  const cfg = structuredClone(sodaxConfig) as SodaxConfig;
  mutate?.(cfg);
  return cfg;
}

const ok = (config: SodaxConfig, version = CONFIG_VERSION): Result<GetAllConfigApiResponse> => ({
  ok: true,
  value: { version, config },
});

describe('ConfigService.initialize — user override is preserved over dynamic config', () => {
  it('re-applies a user override on top of a valid dynamic config', async () => {
    // Remote config carries a DIFFERENT bridge fee; without the fix it would clobber the user's.
    const { service } = makeService(
      { bridge: { partnerFee: USER_FEE } },
      ok(
        remoteConfig(cfg => {
          cfg.bridge.partnerFee = REMOTE_FEE;
        }),
      ),
    );

    const result = await service.initialize();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(service.bridge.partnerFee).toEqual(USER_FEE); // user wins, not REMOTE_FEE
    expect(service.isInitialized()).toBe(true);
  });

  it('user override beats the dynamic config at a nested key, siblings come from remote', async () => {
    const { service } = makeService(
      { api: { timeout: 99_999 } },
      ok(
        remoteConfig(cfg => {
          cfg.api = { ...cfg.api, timeout: 1, baseURL: 'https://remote.example/v1' };
        }),
      ),
    );

    await service.initialize();

    expect(service.sodaxConfig.api.timeout).toBe(99_999); // user override survives
    expect(service.sodaxConfig.api.baseURL).toBe('https://remote.example/v1'); // sibling from remote
  });

  it('adopts dynamic-config values for fields the user did not override', async () => {
    const { service } = makeService(
      { bridge: { partnerFee: USER_FEE } },
      ok(
        remoteConfig(cfg => {
          cfg.api = { ...cfg.api, timeout: 55_555 };
        }),
      ),
    );

    await service.initialize();

    expect(service.sodaxConfig.api.timeout).toBe(55_555); // remote wins where user is silent
    expect(service.bridge.partnerFee).toEqual(USER_FEE); // user wins where set
  });

  it('uses the dynamic config as-is (by reference) when no user override was provided', async () => {
    const remote = remoteConfig(cfg => {
      cfg.bridge.partnerFee = REMOTE_FEE;
    });
    const { service } = makeService(undefined, ok(remote));

    await service.initialize();

    expect(service.sodaxConfig).toBe(remote); // no needless merge clone when there is nothing to layer
    expect(service.bridge.partnerFee).toEqual(REMOTE_FEE);
  });
});

describe('ConfigService.initialize — fallback paths keep the merged config', () => {
  it('keeps the user override when the dynamic config version is too old', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service } = makeService(
      { bridge: { partnerFee: USER_FEE } },
      ok(
        remoteConfig(cfg => {
          cfg.bridge.partnerFee = REMOTE_FEE;
        }),
        CONFIG_VERSION - 1,
      ),
    );

    const result = await service.initialize();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(service.bridge.partnerFee).toEqual(USER_FEE); // stale remote ignored, merged config retained
    expect(service.isInitialized()).toBe(false);
    warn.mockRestore();
  });

  it('keeps the user override when the dynamic config has no version', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service } = makeService(
      { bridge: { partnerFee: USER_FEE } },
      {
        ok: true,
        value: {
          config: remoteConfig(cfg => {
            cfg.bridge.partnerFee = REMOTE_FEE;
          }),
        },
      },
    );

    await service.initialize();

    expect(service.bridge.partnerFee).toEqual(USER_FEE);
    expect(service.isInitialized()).toBe(false);
    warn.mockRestore();
  });

  it('propagates a failed config fetch and keeps the merged config', async () => {
    const error = new Error('network down');
    const { service } = makeService({ bridge: { partnerFee: USER_FEE } }, { ok: false, error });

    const result = await service.initialize();

    expect(result).toEqual({ ok: false, error });
    expect(service.bridge.partnerFee).toEqual(USER_FEE);
    expect(service.isInitialized()).toBe(false);
  });
});

describe('ConfigService — global fee is a held client option, not dynamic config', () => {
  it('exposes the resolved fee option and keeps it off the SodaxConfig data shape', () => {
    const { service } = makeService(undefined, ok(remoteConfig()), USER_FEE);

    expect(service.fee).toEqual(USER_FEE);
    expect('fee' in service.sodaxConfig).toBe(false); // global fee is not part of SodaxConfig
  });

  it('never overwrites the fee option with a dynamic config fetch', async () => {
    // The remote config cannot carry a global fee (it is not part of SodaxConfig), so the
    // client-supplied fee must survive initialize() untouched — like `logger`.
    const { service } = makeService(undefined, ok(remoteConfig()), USER_FEE);

    await service.initialize();

    expect(service.isInitialized()).toBe(true);
    expect(service.fee).toEqual(USER_FEE);
  });

  it('defaults to undefined when no fee option is provided', () => {
    const { service } = makeService(undefined, ok(remoteConfig()));
    expect(service.fee).toBeUndefined();
  });
});

describe('ConfigService — effective per-feature fee falls back to the global fee', () => {
  // The bug this guards: a global `fee` with no per-feature override used to resolve to nothing.
  // Each effective-fee getter must be `featureFee ?? globalFee`.
  const FEATURES = [
    {
      name: 'swap',
      override: (f: PartnerFee): SodaxOptions => ({ swaps: { partnerFee: f } }),
      get: (s: ConfigService) => s.swapPartnerFee,
    },
    {
      name: 'moneyMarket',
      override: (f: PartnerFee): SodaxOptions => ({ moneyMarket: { partnerFee: f } }),
      get: (s: ConfigService) => s.moneyMarketPartnerFee,
    },
    {
      name: 'bridge',
      override: (f: PartnerFee): SodaxOptions => ({ bridge: { partnerFee: f } }),
      get: (s: ConfigService) => s.bridgePartnerFee,
    },
    {
      name: 'leverageYield',
      override: (f: PartnerFee): SodaxOptions => ({ leverageYield: { partnerFee: f } }),
      get: (s: ConfigService) => s.leverageYieldPartnerFee,
    },
  ];

  it.each(FEATURES)('$name: uses the global fee when the per-feature fee is unset', ({ get }) => {
    const { service } = makeService(undefined, ok(remoteConfig()), USER_FEE);
    expect(get(service)).toEqual(USER_FEE); // global fee is the fallback
  });

  it.each(FEATURES)('$name: the per-feature fee overrides the global fee when both are set', ({ override, get }) => {
    const { service } = makeService(override(REMOTE_FEE), ok(remoteConfig()), USER_FEE);
    expect(get(service)).toEqual(REMOTE_FEE); // per-feature wins over global
  });

  it.each(FEATURES)('$name: undefined when neither the per-feature nor the global fee is set', ({ get }) => {
    const { service } = makeService(undefined, ok(remoteConfig()));
    expect(get(service)).toBeUndefined();
  });
});

describe('ConfigService.initialize — commit-last: a rebuild failure leaves prior state intact', () => {
  it('keeps the previously committed config and stays uninitialized when the rebuild throws', async () => {
    // Structurally valid version, but the dynamic config's dex map is removed so the rebuild hits
    // Object.keys(undefined) and throws. With commit-last, this.sodax must remain the pre-init config.
    const malformed = remoteConfig(cfg => {
      Reflect.deleteProperty(cfg.dex, 'statATokenAddresses');
    });
    const { service } = makeService({ bridge: { partnerFee: USER_FEE } }, ok(malformed));
    const before = service.sodaxConfig;

    const result = await service.initialize();

    expect(result.ok).toBe(false); // the throw is caught and surfaced
    expect(service.sodaxConfig).toBe(before); // no torn state — config reference not swapped
    expect(service.isInitialized()).toBe(false);
  });
});
