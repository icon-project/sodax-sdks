/**
 * End-to-end regression guard for the dynamic-config merge bug.
 *
 * NOTE: `ConfigService.initialize()` is currently a deliberate no-op (pending the v2 config endpoint),
 * so the merge regression below is `describe.skip`-ped (restore when initialize() is re-enabled). The
 * live suite asserts the current no-op contract + the Sodax → ConfigService constructor wiring.
 *
 * The bug: ConfigService.initialize() did `this.sodax = response.config`, wholesale replacing the
 * merged config with the remote one. Because Sodax only handed ConfigService the already-merged
 * instanceConfig, a successful `initialize()` silently discarded every override the caller passed
 * to `new Sodax(...)`.
 *
 * Unlike Sodax.test.ts (which mocks ConfigService) and ConfigService.test.ts (which constructs the
 * service in isolation, handing it `userConfig` directly), this test drives the REAL public-API
 * path — `new Sodax(override)` → `sodax.initialize()` — with only the network boundary
 * (`backendApi.getAllConfig`) stubbed. It therefore guards BOTH halves of the fix at once:
 *   1. the Sodax → ConfigService wiring (Sodax must forward the raw `userConfig`), and
 *   2. ConfigService re-layering that override on top of the dynamic config.
 * A regression in either half turns this test red — which the isolated tests cannot guarantee.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sodaxConfig, CONFIG_VERSION, type SodaxConfig, type PartnerFee } from '@sodax/types';
import { Sodax } from './Sodax.js';

const USER_FEE: PartnerFee = { address: '0x1111111111111111111111111111111111111111', percentage: 123 };
const REMOTE_FEE: PartnerFee = { address: '0x9999999999999999999999999999999999999999', percentage: 1 };

afterEach(() => {
  vi.restoreAllMocks();
});

// TODO(config-v2): un-skip when ConfigService.initialize is re-enabled; rewrite mocks for the flattened GetAllConfigApiResponse.
// biome-ignore lint/suspicious/noSkippedTests: gated on the not-yet-live config-v2 endpoint (see TODO above); re-enable with ConfigService.initialize.
describe.skip('Sodax.initialize — regression: dynamic config must not clobber user overrides', () => {
  it('preserves a top-level user override through a successful initialize() while adopting remote values elsewhere', async () => {
    const sodax = new Sodax({ fee: USER_FEE });

    // Remote config carries a DIFFERENT fee (the old bug would let this overwrite the user's) plus a
    // changed, non-overridden field (api.timeout) to prove the dynamic config is genuinely adopted.
    const remote = structuredClone(sodaxConfig) as SodaxConfig;
    remote.fee = REMOTE_FEE;
    remote.api = { ...remote.api, timeout: 77_777 };

    vi.spyOn(sodax.backendApi, 'getAllConfig').mockResolvedValue({
      ok: true,
      value: { version: CONFIG_VERSION, config: remote },
    });

    const result = await sodax.initialize();

    expect(result.ok).toBe(true);
    // The crux: under the old `this.sodax = response.config`, this equaled REMOTE_FEE after init.
    expect(sodax.config.sodaxConfig.fee).toEqual(USER_FEE);
    // Sanity: a field the user did NOT override picks up the dynamic-config value — confirms the
    // assertion above is real preservation, not initialize() being a no-op.
    expect(sodax.config.sodaxConfig.api.timeout).toBe(77_777);
    expect(sodax.config.isInitialized()).toBe(true);
  });

  it('lets a nested user override win over the same nested key in the dynamic config', async () => {
    const sodax = new Sodax({ api: { timeout: 99_999 } });

    const remote = structuredClone(sodaxConfig) as SodaxConfig;
    remote.api = { ...remote.api, timeout: 1, baseURL: 'https://remote.example/v1' };

    vi.spyOn(sodax.backendApi, 'getAllConfig').mockResolvedValue({
      ok: true,
      value: { version: CONFIG_VERSION, config: remote },
    });

    await sodax.initialize();

    expect(sodax.config.sodaxConfig.api.timeout).toBe(99_999); // user override survives
    expect(sodax.config.sodaxConfig.api.baseURL).toBe('https://remote.example/v1'); // sibling from remote
  });
});

describe('Sodax.initialize — current no-op contract (dynamic fetch/merge disabled)', () => {
  it('resolves ok, preserves the constructor-merged override, and does not fetch while initialize() is a no-op', async () => {
    const sodax = new Sodax({ fee: USER_FEE });
    const getAllConfig = vi.spyOn(sodax.backendApi, 'getAllConfig');

    const result = await sodax.initialize();

    expect(result.ok).toBe(true);
    expect(sodax.config.sodaxConfig.fee).toEqual(USER_FEE); // Sodax → ConfigService wiring carries the override
    expect(sodax.config.isInitialized()).toBe(false); // no-op never flips the flag
    expect(getAllConfig).not.toHaveBeenCalled(); // initialize() does not fetch while disabled
  });
});
