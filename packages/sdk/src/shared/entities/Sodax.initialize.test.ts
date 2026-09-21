/**
 * End-to-end guard for the Sodax → ConfigService wiring and the current no-op initialize() contract.
 *
 * NOTE: `ConfigService.initialize()` is currently a deliberate no-op (pending the v2 config endpoint),
 * so the dynamic-config merge regression suite is preserved as a COMMENTED block below — biome's
 * `noSkippedTests` forbids `.skip`. Restore it (and the `sodaxConfig` / `CONFIG_VERSION` / `SodaxConfig`
 * imports and the `REMOTE_FEE` constant it needs) when initialize()'s dynamic fetch is re-enabled.
 *
 * The regression it guards: ConfigService.initialize() did `this.sodax = response.config`, wholesale
 * replacing the merged config with the remote one. Because Sodax only handed ConfigService the
 * already-merged instanceConfig, a successful `initialize()` silently discarded every override the
 * caller passed to `new Sodax(...)`. The fix re-layers the raw user override on top of the dynamic
 * config; this E2E test drives the real `new Sodax(override)` → `sodax.initialize()` path with only
 * `backendApi.getAllConfig` stubbed, guarding both the Sodax → ConfigService wiring and the re-layer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PartnerFee } from '@sodax/types';
import { Sodax } from './Sodax.js';

const USER_FEE: PartnerFee = { address: '0x1111111111111111111111111111111111111111', percentage: 123 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Sodax.initialize — current no-op contract (dynamic fetch/merge disabled)', () => {
  it('resolves ok, preserves the constructor-merged override, and does not fetch while initialize() is a no-op', async () => {
    const sodax = new Sodax({ fee: USER_FEE });
    const getAllConfig = vi.spyOn(sodax.backendApi, 'getAllConfig');

    const result = await sodax.initialize();

    expect(result.ok).toBe(true);
    expect(sodax.config.fee).toEqual(USER_FEE); // Sodax → ConfigService wiring carries the held fee option
    expect(sodax.config.isInitialized()).toBe(false); // no-op never flips the flag
    expect(getAllConfig).not.toHaveBeenCalled(); // initialize() does not fetch while disabled
  });
});

/*
 * TODO(config-v2): restore verbatim when ConfigService.initialize()'s dynamic fetch is re-enabled.
 * Also re-add to the imports: `sodaxConfig, CONFIG_VERSION, type SodaxConfig` from '@sodax/types',
 * and the constant:
 *   const REMOTE_FEE: PartnerFee = { address: '0x9999999999999999999999999999999999999999', percentage: 1 };
 *
 * describe('Sodax.initialize — regression: dynamic config must not clobber user overrides', () => {
 *   it('preserves a user override through a successful initialize() while adopting remote values elsewhere', async () => {
 *     const sodax = new Sodax({ bridge: { partnerFee: USER_FEE } });
 *
 *     // Remote config carries a DIFFERENT bridge fee (the old bug would let this overwrite the user's)
 *     // plus a changed, non-overridden field (api.timeout) to prove the dynamic config is genuinely adopted.
 *     const remote = structuredClone(sodaxConfig) as SodaxConfig;
 *     remote.bridge.partnerFee = REMOTE_FEE;
 *     remote.api = { ...remote.api, timeout: 77_777 };
 *
 *     vi.spyOn(sodax.backendApi, 'getAllConfig').mockResolvedValue({
 *       ok: true,
 *       value: { version: CONFIG_VERSION, config: remote },
 *     });
 *
 *     const result = await sodax.initialize();
 *
 *     expect(result.ok).toBe(true);
 *     expect(sodax.config.bridge.partnerFee).toEqual(USER_FEE); // user override survives init
 *     expect(sodax.config.sodaxConfig.api.timeout).toBe(77_777); // non-overridden field adopts remote
 *     expect(sodax.config.isInitialized()).toBe(true);
 *   });
 *
 *   it('lets a nested user override win over the same nested key in the dynamic config', async () => {
 *     const sodax = new Sodax({ api: { timeout: 99_999 } });
 *
 *     const remote = structuredClone(sodaxConfig) as SodaxConfig;
 *     remote.api = { ...remote.api, timeout: 1, baseURL: 'https://remote.example/v1' };
 *
 *     vi.spyOn(sodax.backendApi, 'getAllConfig').mockResolvedValue({
 *       ok: true,
 *       value: { version: CONFIG_VERSION, config: remote },
 *     });
 *
 *     await sodax.initialize();
 *
 *     expect(sodax.config.sodaxConfig.api.timeout).toBe(99_999); // user override survives
 *     expect(sodax.config.sodaxConfig.api.baseURL).toBe('https://remote.example/v1'); // sibling from remote
 *   });
 * });
 */
