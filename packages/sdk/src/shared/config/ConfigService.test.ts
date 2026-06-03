/**
 * Tests for ConfigService.initialize() — the dynamic-config merge contract.
 *
 * The behavior under test: a successful remote-config fetch REPLACES the static defaults
 * (so chains/tokens can change without an SDK release), but it must NOT clobber the explicit
 * overrides the caller passed to `new Sodax(...)`. Those user overrides are re-layered on top
 * of the dynamic config via deepMerge.
 *
 * Each test constructs a real ConfigService backed by a fake BackendApiService whose
 * `getAllConfig` resolves to a scripted Result. The wiring mirrors Sodax exactly:
 *   - `config`     = deepMerge(sodaxConfig, userOverride)  (the merged instanceConfig)
 *   - `userConfig` = the raw partial override
 */
import { describe, expect, it, vi } from 'vitest';
import {
  sodaxConfig,
  CONFIG_VERSION,
  type SodaxConfig,
  type DeepPartial,
  type Result,
  type GetAllConfigApiResponse,
  type PartnerFee,
} from '@sodax/types';
import { ConfigService } from './ConfigService.js';
import { deepMerge } from '../utils/deepMerge.js';
import type { BackendApiService } from '../../backendApi/BackendApiService.js';

function makeService(userConfig: DeepPartial<SodaxConfig> | undefined, response: Result<GetAllConfigApiResponse>) {
  const getAllConfig = vi.fn().mockResolvedValue(response);
  const api = { getAllConfig } as unknown as BackendApiService;
  const config = userConfig ? deepMerge<SodaxConfig>(sodaxConfig, userConfig) : sodaxConfig;
  const service = new ConfigService({ api, config, userConfig });
  return { service, getAllConfig };
}

const USER_FEE: PartnerFee = { address: '0x1111111111111111111111111111111111111111', percentage: 123 };
const REMOTE_FEE: PartnerFee = { address: '0x9999999999999999999999999999999999999999', percentage: 1 };
const USER_FEE_AMOUNT: PartnerFee = { address: '0x1111111111111111111111111111111111111111', amount: 50n };
const REMOTE_FEE_AMOUNT: PartnerFee = { address: '0x9999999999999999999999999999999999999999', amount: 7n };

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
  it('re-applies a top-level user override on top of a valid dynamic config', async () => {
    // Remote config carries a DIFFERENT fee; without the fix it would clobber the user's.
    const { service } = makeService(
      { fee: USER_FEE },
      ok(
        remoteConfig(cfg => {
          cfg.fee = REMOTE_FEE;
        }),
      ),
    );

    const result = await service.initialize();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(service.sodaxConfig.fee).toEqual(USER_FEE); // user wins, not REMOTE_FEE
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
      { fee: USER_FEE },
      ok(
        remoteConfig(cfg => {
          cfg.api = { ...cfg.api, timeout: 55_555 };
        }),
      ),
    );

    await service.initialize();

    expect(service.sodaxConfig.api.timeout).toBe(55_555); // remote wins where user is silent
    expect(service.sodaxConfig.fee).toEqual(USER_FEE); // user wins where set
  });

  it('uses the dynamic config as-is (by reference) when no user override was provided', async () => {
    const remote = remoteConfig(cfg => {
      cfg.fee = REMOTE_FEE;
    });
    const { service } = makeService(undefined, ok(remote));

    await service.initialize();

    expect(service.sodaxConfig).toBe(remote); // no needless merge clone when there is nothing to layer
    expect(service.sodaxConfig.fee).toEqual(REMOTE_FEE);
  });
});

describe('ConfigService.initialize — fallback paths keep the merged config', () => {
  it('keeps the user override when the dynamic config version is too old', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service } = makeService(
      { fee: USER_FEE },
      ok(
        remoteConfig(cfg => {
          cfg.fee = REMOTE_FEE;
        }),
        CONFIG_VERSION - 1,
      ),
    );

    const result = await service.initialize();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(service.sodaxConfig.fee).toEqual(USER_FEE); // stale remote ignored, merged config retained
    expect(service.isInitialized()).toBe(false);
    warn.mockRestore();
  });

  it('keeps the user override when the dynamic config has no version', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service } = makeService(
      { fee: USER_FEE },
      {
        ok: true,
        value: {
          config: remoteConfig(cfg => {
            cfg.fee = REMOTE_FEE;
          }),
        },
      },
    );

    await service.initialize();

    expect(service.sodaxConfig.fee).toEqual(USER_FEE);
    expect(service.isInitialized()).toBe(false);
    warn.mockRestore();
  });

  it('propagates a failed config fetch and keeps the merged config', async () => {
    const error = new Error('network down');
    const { service } = makeService({ fee: USER_FEE }, { ok: false, error });

    const result = await service.initialize();

    expect(result).toEqual({ ok: false, error });
    expect(service.sodaxConfig.fee).toEqual(USER_FEE);
    expect(service.isInitialized()).toBe(false);
  });
});

describe('ConfigService.initialize — PartnerFee variant is atomic, not deep-merged', () => {
  it('a percentage user override replaces an amount-variant dynamic fee wholesale (no hybrid)', async () => {
    // The regression: a naive deep-merge would yield { address, amount, percentage }, which downstream
    // discrimination reads as the amount variant — silently dropping the user's percentage.
    const { service } = makeService(
      { fee: USER_FEE }, // percentage variant
      ok(
        remoteConfig(cfg => {
          cfg.fee = REMOTE_FEE_AMOUNT; // amount variant
        }),
      ),
    );

    await service.initialize();

    expect(service.sodaxConfig.fee).toEqual(USER_FEE); // exact user variant, no leftover `amount` key
    expect(service.sodaxConfig.fee && 'amount' in service.sodaxConfig.fee).toBe(false);
  });

  it('an amount user override replaces a percentage-variant dynamic fee wholesale (no hybrid)', async () => {
    const { service } = makeService(
      { fee: USER_FEE_AMOUNT }, // amount variant
      ok(
        remoteConfig(cfg => {
          cfg.fee = REMOTE_FEE; // percentage variant
        }),
      ),
    );

    await service.initialize();

    expect(service.sodaxConfig.fee).toEqual(USER_FEE_AMOUNT);
    expect(service.sodaxConfig.fee && 'percentage' in service.sodaxConfig.fee).toBe(false);
  });

  it('applies the same atomic rule to bridge.partnerFee', async () => {
    const { service } = makeService(
      { bridge: { partnerFee: USER_FEE } }, // percentage variant
      ok(
        remoteConfig(cfg => {
          cfg.bridge.partnerFee = REMOTE_FEE_AMOUNT; // amount variant
        }),
      ),
    );

    await service.initialize();

    expect(service.bridge.partnerFee).toEqual(USER_FEE);
    expect(service.bridge.partnerFee && 'amount' in service.bridge.partnerFee).toBe(false);
  });
});

describe('ConfigService.initialize — commit-last: a rebuild failure leaves prior state intact', () => {
  it('keeps the previously committed config and stays uninitialized when the rebuild throws', async () => {
    // Structurally valid version, but the dynamic config's dex map is removed so the rebuild hits
    // Object.keys(undefined) and throws. With commit-last, this.sodax must remain the pre-init config.
    const malformed = remoteConfig(cfg => {
      Reflect.deleteProperty(cfg.dex, 'statATokenAddresses');
    });
    const { service } = makeService({ fee: USER_FEE }, ok(malformed));
    const before = service.sodaxConfig;

    const result = await service.initialize();

    expect(result.ok).toBe(false); // the throw is caught and surfaced
    expect(service.sodaxConfig).toBe(before); // no torn state — config reference not swapped
    expect(service.isInitialized()).toBe(false);
  });
});
