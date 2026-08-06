/**
 * Tests for LeverageYieldService.
 *
 * Two layers of coverage:
 *  - Pure / builder surface: the static vault registry, and the `deposit` / `withdraw`
 *    intent builders that produce a `LeverageYieldSwapPayload`.
 *  - Orchestration + reads (mocked collaborators): `createVaultIntent`'s three branches
 *    (hub-wallet sendMessage, Sonic-direct, EVM-spoke deposit), the `vaultSwap` lifecycle
 *    (verify → relay → notify-solver, plus error mapping), `approve` / `isAllowanceValid`,
 *    the steady-state APR math (`getApr` / `getEffectiveApr` / `getLsdApr`, including the
 *    inverted-spread case and the `targetLTV < 100%` basis-points invariant), and the
 *    `getMaxWithdrawForUser` dust-buffer clamp.
 *
 * Collaborator mocking mirrors `src/swap/SwapService.test.ts`: instance methods on the live
 * `new Sodax()` graph are stubbed with `vi.spyOn`; static / module-level collaborators are
 * replaced via `vi.hoisted` + `vi.mock` of their source leaf modules.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import {
  ChainKeys,
  getIntentRelayChainId,
  type IBitcoinWalletProvider,
  type IEvmWalletProvider,
  type SpokeChainKey,
} from '@sodax/sdk';
import type { CreateIntentParams, Intent } from '../shared/types/intent-types.js';
import { SodaxError } from '../errors/SodaxError.js';

// ── Module mocks for static / module-level collaborators (mirrors SwapService.test.ts) ──
// LeverageYieldService reaches these as static imports — via the `../shared/index.js` barrel
// (SonicSpokeService, relayTxAndWaitPacket, Erc20Service, Erc4626Service) or directly
// (`../swap/*`). A direct `vi.spyOn(Foo, ...)` through the barrel is unreliable, so we mock
// the *source* leaf modules; vitest hoists `vi.mock`, and the barrel re-exports resolve to
// the mocked modules.
const mocks = vi.hoisted(() => ({
  getUserHubWalletAddress: vi.fn(),
  constructCreateIntentData: vi.fn(),
  sonicCreateSwapIntent: vi.fn(),
  relayTxAndWaitPacket: vi.fn(),
  solverPostExecution: vi.fn(),
  erc20Approve: vi.fn(),
  erc20PlanApproval: vi.fn(),
  erc4626GetMaxWithdraw: vi.fn(),
  erc4626GetTotalAssets: vi.fn(),
  erc4626PreviewDeposit: vi.fn(),
  erc4626PreviewWithdraw: vi.fn(),
  erc4626PreviewRedeem: vi.fn(),
}));
// SonicSpokeService is instantiated by EvmHubProvider AND used statically — mock as a class.
vi.mock('../shared/services/spoke/SonicSpokeService.js', () => {
  class SonicSpokeService {
    static createSwapIntent = mocks.sonicCreateSwapIntent;
  }
  return { SonicSpokeService };
});
vi.mock('../swap/EvmSolverService.js', () => ({
  EvmSolverService: { constructCreateIntentData: mocks.constructCreateIntentData },
}));
vi.mock('../swap/SolverApiService.js', () => ({
  SolverApiService: { postExecution: mocks.solverPostExecution },
}));
vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return { ...actual, relayTxAndWaitPacket: mocks.relayTxAndWaitPacket };
});
vi.mock('../shared/services/erc-20/Erc20Service.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/erc-20/Erc20Service.js');
  return { ...actual, Erc20Service: { approve: mocks.erc20Approve, planApproval: mocks.erc20PlanApproval } };
});
vi.mock('../shared/services/Erc4626Service.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/Erc4626Service.js');
  return {
    ...actual,
    Erc4626Service: {
      getMaxWithdraw: mocks.erc4626GetMaxWithdraw,
      getTotalAssets: mocks.erc4626GetTotalAssets,
      previewDeposit: mocks.erc4626PreviewDeposit,
      previewWithdraw: mocks.erc4626PreviewWithdraw,
      previewRedeem: mocks.erc4626PreviewRedeem,
    },
  };
});
import { Sodax } from '../shared/entities/Sodax.js';

const sodax = new Sodax();
const HUB = sodax.hubProvider.chainConfig.chain.key;

const ARBITRUM = ChainKeys.ARBITRUM_MAINNET satisfies SpokeChainKey;
const SONIC = ChainKeys.SONIC_MAINNET satisfies SpokeChainKey;
const SAMPLE_USER = '0x4444444444444444444444444444444444444444' as Address;
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Address;
const VAULT = '0xD09de2f5070699A909c0FD32fb5A909d3886701D' as Address;
const SODA_ASSET = '0xCb6B152D3a943f25157381aFcA7fEFCD2ef5a357' as Address; // sodaWEETH
const SPOKE_TOKEN = '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe' as Address; // arb weETH
const POOL = '0x9999999999999999999999999999999999999999' as Address;
const BORROW_TOKEN = '0x8888888888888888888888888888888888888888' as Address; // sodaETH stand-in
const ANY_SOLVER = '0x0000000000000000000000000000000000000000' as Address;
/** Fixed hub block timestamp returned by the `getBlock` stub, so the default deadline is deterministic. */
const HUB_BLOCK_TIMESTAMP = 1_700_000_000n;
/** Mirrors `INTENT_DEADLINE_BUFFER_SECONDS` (5 min) in LeverageYieldService — the default deadline offset. */
const DEADLINE_BUFFER_SECONDS = 5n * 60n;

const RAY = 10n ** 27n;
const WAD = 10n ** 18n;
/** `n` percent expressed in RAY (1e27 = 100%). `pctRay(3)` → `3e25`. */
const pctRay = (n: number): bigint => (BigInt(Math.round(n * 1e9)) * RAY) / 1_000_000_000n / 100n;

// EVM wallet provider fake — exec-mode (raw: false) createVaultIntent / vaultSwap / approve
// need a chain-matched provider; `getWalletAddress` is resolved in beforeEach.
const mockEvmProvider = {
  chainType: 'EVM',
  getWalletAddress: vi.fn(),
  sendTransaction: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;

// Bitcoin wallet provider fake — passes the `isBitcoinWalletProviderType` guard (chainType
// discriminator) for the hub-wallet-swap (withdraw) trading-wallet path.
const mockBitcoinProvider = {
  chainType: 'BITCOIN',
  getWalletAddress: vi.fn(),
  signMessage: vi.fn(),
} as unknown as IBitcoinWalletProvider;

/** Intent fixture compatible with createVaultIntent's `{ ...intent, feeAmount }` shape. */
function makeIntent(
  srcChainKey: Parameters<typeof getIntentRelayChainId>[0] = ARBITRUM,
  overrides: Partial<Intent> = {},
): Intent {
  return {
    intentId: 1n,
    creator: HUB_WALLET,
    inputToken: SODA_ASSET,
    outputToken: VAULT,
    inputAmount: 1_000n,
    minOutputAmount: 900n,
    deadline: 0n,
    allowPartialFill: false,
    srcChain: getIntentRelayChainId(srcChainKey),
    dstChain: getIntentRelayChainId(HUB),
    srcAddress: '0x1111111111111111111111111111111111111111',
    dstAddress: '0x2222222222222222222222222222222222222222',
    solver: ANY_SOLVER,
    data: '0x',
    ...overrides,
  };
}

/** Base `CreateIntentParams` for a deposit (any token → lsoda* on the hub). */
const vaultIntentParams = <K extends SpokeChainKey>(
  srcChainKey: K,
  overrides: Partial<CreateIntentParams<K>> = {},
): CreateIntentParams<K> => ({
  inputToken: SPOKE_TOKEN,
  outputToken: VAULT,
  inputAmount: 1_000n,
  minOutputAmount: 900n,
  deadline: 0n,
  allowPartialFill: false,
  srcChainKey,
  dstChainKey: HUB as SpokeChainKey,
  srcAddress: SAMPLE_USER,
  dstAddress: HUB_WALLET,
  solver: ANY_SOLVER,
  data: '0x',
  ...overrides,
});

/**
 * Installs a `publicClient.readContract` dispatcher keyed on `functionName` (and, for the
 * two `getReserveData` reads in `getApr`, on `args[0]` = asset vs borrowToken). Only the
 * fields a given test exercises need to be supplied.
 */
type ReadContractStub = {
  asset?: Address;
  borrowToken?: Address;
  pool?: Address;
  targetLtvBps?: bigint;
  supplyAprRay?: bigint;
  borrowAprRay?: bigint;
  position?: readonly [bigint, bigint, bigint, bigint, bigint];
  balance?: bigint;
  allowance?: bigint;
};
function stubReadContract(cfg: ReadContractStub): void {
  const asset = cfg.asset ?? SODA_ASSET;
  vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
    functionName: string;
    args?: readonly unknown[];
  }) => {
    switch (call.functionName) {
      case 'pool':
        return cfg.pool ?? POOL;
      case 'asset':
        return asset;
      case 'borrowToken':
        return cfg.borrowToken ?? BORROW_TOKEN;
      case 'targetLTV':
        return cfg.targetLtvBps;
      case 'getReserveData':
        return call.args?.[0] === asset
          ? { currentLiquidityRate: cfg.supplyAprRay ?? 0n, currentVariableBorrowRate: 0n }
          : { currentLiquidityRate: 0n, currentVariableBorrowRate: cfg.borrowAprRay ?? 0n };
      case 'getPositionDetails':
        return cfg.position;
      case 'balanceOf':
        return cfg.balance;
      case 'allowance':
        return cfg.allowance;
      default:
        throw new Error(`unexpected readContract: ${call.functionName}`);
    }
  }) as never);
}

beforeEach(() => {
  // Real config doesn't know our synthetic token/address pairs — stub the validity predicates.
  vi.spyOn(sodax.config, 'isValidOriginalAssetAddress').mockReturnValue(true);
  vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValue(true);
  vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
  // Bind the hoisted hub-wallet stub to the live instance method, with a sane default.
  vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockImplementation(mocks.getUserHubWalletAddress);
  mocks.getUserHubWalletAddress.mockResolvedValue(HUB_WALLET);
  (mockEvmProvider.getWalletAddress as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_USER);
  // approve() now routes through SpokeService, which plans the approval first. Default to the
  // ordinary single-transaction plan; the reset case is asserted explicitly.
  mocks.erc20PlanApproval.mockImplementation(async ({ amount }: { amount: bigint }) => ({
    approveAmount: amount,
    reason: 'zero-allowance',
  }));
  // deposit/withdraw default the intent deadline to the hub block timestamp (not the client
  // clock) — stub getBlock so the default resolves deterministically.
  vi.spyOn(sodax.hubProvider.publicClient, 'getBlock').mockResolvedValue({ timestamp: HUB_BLOCK_TIMESTAMP } as never);
});
afterEach(() => {
  // restoreAllMocks() also strips the default impls off the hoisted vi.fn()s — re-applied above.
  vi.restoreAllMocks();
  // getLsdApr / getEffectiveApr tests stub global `fetch`; clear it so it can't leak.
  vi.unstubAllGlobals();
  // The DefiLlama fallback tests run on fake timers to skip the retry back-off — reset here.
  vi.useRealTimers();
});

// ─── Registry lookups ─────────────────────────────────────────────────────

describe('LeverageYieldService — registry', () => {
  it('listVaults returns the @sodax/types registry entries', () => {
    const vaults = sodax.leverageYield.listVaults();
    expect(vaults.length).toBeGreaterThan(0);
    expect(vaults[0]).toMatchObject({ name: 'lsodaWEETH', vault: VAULT, asset: SODA_ASSET });
  });

  it('getVault by name returns the matching entry, or undefined for an unknown name', () => {
    expect(sodax.leverageYield.getVault('lsodaWEETH')?.vault).toBe(VAULT);
    expect(sodax.leverageYield.getVault('nonexistent-vault')).toBeUndefined();
  });

  it('getVaultByAddress is case-insensitive and returns undefined for unknown addresses', () => {
    expect(sodax.leverageYield.getVaultByAddress(VAULT.toLowerCase() as Address)?.name).toBe('lsodaWEETH');
    expect(sodax.leverageYield.getVaultByAddress(VAULT.toUpperCase() as Address)?.name).toBe('lsodaWEETH');
    expect(
      sodax.leverageYield.getVaultByAddress('0x0000000000000000000000000000000000000000' as Address),
    ).toBeUndefined();
  });
});

// ─── Swap-intent builders ─────────────────────────────────────────────────

describe('LeverageYieldService.deposit — intent builder', () => {
  it('builds a swap into the vault lsoda* token, delivered to the hub wallet', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);

    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.params).toMatchObject({
      inputToken: SPOKE_TOKEN,
      outputToken: VAULT, // the vault address doubles as the lsoda* token
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      srcChainKey: ARBITRUM,
      dstChainKey: sodax.hubProvider.chainConfig.chain.key, // lsoda* lands on the hub
      srcAddress: SAMPLE_USER,
      dstAddress: HUB_WALLET, // delivered to the hub wallet so `withdraw` can spend it
    });
    // Default deadline is derived from the hub block timestamp, not the client clock.
    expect(result.value.params.deadline).toBe(HUB_BLOCK_TIMESTAMP + DEADLINE_BUFFER_SECONDS);
    expect(result.value.hubWalletSwap).toBeUndefined();
  });

  it('forwards a caller-supplied partnerFee on the payload (per-intent override)', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    const partnerFee = { address: SAMPLE_USER, percentage: 100 } as const;

    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      partnerFee,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.partnerFee).toEqual(partnerFee);
  });

  it('omits partnerFee from the payload when the caller does not supply one', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);

    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('partnerFee' in result.value).toBe(false);
  });

  it('rejects a non-positive inputAmount', async () => {
    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 0n,
      minOutputAmount: 0n,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('inputAmount');
  });

  it('surfaces a getBlock RPC failure during default-deadline resolution as LOOKUP_FAILED (method=resolveDeadline), not INTENT_CREATION_FAILED', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    vi.spyOn(sodax.hubProvider.publicClient, 'getBlock').mockRejectedValueOnce(new Error('rpc down'));

    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('resolveDeadline');
    expect(result.error.context?.srcChainKey).toBe(ARBITRUM);
  });
});

describe('LeverageYieldService.withdraw — intent builder', () => {
  it('builds a hub-wallet swap of lsoda* into the chosen output token', async () => {
    const result = await sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.params).toMatchObject({
      inputToken: VAULT, // lsoda* shares are the swap input
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      srcChainKey: ARBITRUM,
      dstChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstAddress: SAMPLE_USER, // recipient defaults to srcAddress
    });
    // Default deadline is derived from the hub block timestamp, not the client clock.
    expect(result.value.params.deadline).toBe(HUB_BLOCK_TIMESTAMP + DEADLINE_BUFFER_SECONDS);
    expect(result.value.hubWalletSwap).toBe(true); // routes vaultSwap() through the hub-wallet sendMessage path
  });

  it('honours an explicit recipient', async () => {
    const result = await sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      recipient: HUB_WALLET,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.params.dstAddress).toBe(HUB_WALLET);
  });

  it('honours an explicit deadline without reading the hub block', async () => {
    const getBlock = vi.spyOn(sodax.hubProvider.publicClient, 'getBlock');
    const explicitDeadline = 9_999_999_999n;

    const result = await sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      deadline: explicitDeadline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.params.deadline).toBe(explicitDeadline);
    expect(getBlock).not.toHaveBeenCalled();
  });

  it('rejects an empty vault address', async () => {
    const result = await sodax.leverageYield.withdraw({
      vault: '' as Address,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('vault');
  });

  it('surfaces a getBlock RPC failure during default-deadline resolution as LOOKUP_FAILED (method=resolveDeadline)', async () => {
    vi.spyOn(sodax.hubProvider.publicClient, 'getBlock').mockRejectedValueOnce(new Error('rpc down'));

    const result = await sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('resolveDeadline');
    expect(result.error.context?.srcChainKey).toBe(ARBITRUM);
  });
});

// ─── getApr — steady-state leverage APR (pins the basis-points targetLTV scale) ──

describe('LeverageYieldService.getApr', () => {
  it('computes supply/borrow/leverage/net APR from the AAVE rates at the vault targetLTV', async () => {
    const supplyAprRay = pctRay(3); // 3%
    const borrowAprRay = pctRay(2); // 2%
    stubReadContract({
      pool: POOL,
      asset: SODA_ASSET,
      borrowToken: BORROW_TOKEN,
      targetLtvBps: 8000n,
      supplyAprRay,
      borrowAprRay,
    });

    const result = await sodax.leverageYield.getApr(VAULT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // leverage = 0.8 / (1 - 0.8) = 4x ; net = supply + 4 × (supply − borrow) = 3% + 4 × 1% = 7%
    expect(result.value).toEqual({
      supplyAprRay,
      borrowAprRay,
      targetLtvBps: 8000n,
      leverageMultiplierWad: 4n * WAD,
      netAprRay: pctRay(7),
    });
  });

  it('returns a negative netAprRay when the borrow rate exceeds the supply rate (inverted spread)', async () => {
    stubReadContract({
      pool: POOL,
      asset: SODA_ASSET,
      borrowToken: BORROW_TOKEN,
      targetLtvBps: 8000n,
      supplyAprRay: pctRay(2),
      borrowAprRay: pctRay(3),
    });

    const result = await sodax.leverageYield.getApr(VAULT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // net = 2% + 4 × (2% − 3%) = 2% − 4% = −2%
    expect(result.value.netAprRay).toBe(-pctRay(2));
    expect(result.value.netAprRay < 0n).toBe(true);
  });

  it('rejects targetLTV ≥ 100% (10_000 bps) — the basis-points invariant trips', async () => {
    stubReadContract({
      pool: POOL,
      asset: SODA_ASSET,
      borrowToken: BORROW_TOKEN,
      targetLtvBps: 10_000n,
      supplyAprRay: pctRay(3),
      borrowAprRay: pctRay(2),
    });

    const result = await sodax.leverageYield.getApr(VAULT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // LookupErrorCode includes VALIDATION_FAILED, so getApr surfaces the targetLTV<100%
    // (basis-points) invariant directly rather than re-wrapping it as LOOKUP_FAILED.
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.method).toBe('getApr');
    expect(result.error.context?.field).toBe('targetLtvBps');
    expect(result.error.message).toContain('10_000 bps');
  });

  it('wraps a readContract failure as LOOKUP_FAILED with method=getApr', async () => {
    const boom = new Error('rpc down');
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockRejectedValue(boom);

    const result = await sodax.leverageYield.getApr(VAULT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('getApr');
    expect(result.error.cause).toBe(boom);
  });
});

// ─── getLsdApr / getEffectiveApr — off-chain LSD yield + folded effective APR ──

describe('LeverageYieldService.getLsdApr', () => {
  it('returns a zero, stale snapshot for a vault with no configured LSD source', async () => {
    const result = await sodax.leverageYield.getLsdApr('0x000000000000000000000000000000000000dEaD' as Address);
    expect(result).toEqual({ ok: true, value: { aprRay: 0n, label: 'no LSD source', stale: true } });
  });

  it('falls back to the registry fallbackAprPct (stale) when the DefiLlama fetch fails', async () => {
    // Fake timers skip the shared retry helper's back-off so the test doesn't wait on it.
    vi.useFakeTimers();
    const warn = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const promise = sodax.leverageYield.getLsdApr(VAULT); // lsodaWEETH, fallbackAprPct 3.0
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ aprRay: pctRay(3), label: 'EtherFi (weETH) (fallback)', stale: true });
    // The fallback is logged, not silently swallowed.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DefiLlama APR fetch failed'), expect.any(Object));
  });

  it('uses the live DefiLlama apy (not stale) when the fetch succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ apy: 2.4 }] }) }));
    const result = await sodax.leverageYield.getLsdApr(VAULT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ aprRay: pctRay(2.4), label: 'EtherFi (weETH)', stale: false });
  });
});

describe('LeverageYieldService.getEffectiveApr', () => {
  it('folds the LSD staking yield into the supply side and re-applies leverage', async () => {
    // Fake timers skip the shared retry helper's back-off on the failing DefiLlama fetch.
    vi.useFakeTimers();
    vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network'))); // → fallback lsd = 3%
    stubReadContract({
      pool: POOL,
      asset: SODA_ASSET,
      borrowToken: BORROW_TOKEN,
      targetLtvBps: 8000n,
      supplyAprRay: pctRay(3),
      borrowAprRay: pctRay(2),
    });

    const promise = sodax.leverageYield.getEffectiveApr(VAULT);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // effectiveSupply = 3% + 3% = 6% ; effectiveNet = 6% + 4 × (6% − 2%) = 6% + 16% = 22%
    expect(result.value.effectiveSupplyAprRay).toBe(pctRay(6));
    expect(result.value.effectiveNetAprRay).toBe(pctRay(22));
    expect(result.value.netAprRay).toBe(pctRay(7)); // AAVE-only headline preserved
    expect(result.value.lsdApr).toEqual({ aprRay: pctRay(3), label: 'EtherFi (weETH) (fallback)', stale: true });
  });
});

// ─── createVaultIntent — the three creation branches + fee override + errors ──

describe('LeverageYieldService.createVaultIntent', () => {
  it('on an EVM spoke, builds intent data and deposits via SpokeService', async () => {
    const intent = makeIntent(ARBITRUM);
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xdata', intent, 5n]);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tx).toBe('0xspokeTx');
    expect(result.value.intent.feeAmount).toBe(5n);
    expect(result.value.relayData).toEqual({ address: intent.creator, payload: '0xdata' });
    expect(sodax.spoke.deposit).toHaveBeenCalledTimes(1);
  });

  it('on Sonic (hub) source, creates the intent directly via SonicSpokeService.createSwapIntent', async () => {
    const intent = makeIntent(SONIC);
    mocks.sonicCreateSwapIntent.mockResolvedValueOnce(['0xsonicTx', intent, 0n, '0xdata']);

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(SONIC),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tx).toBe('0xsonicTx');
    expect(result.value.relayData).toEqual({ address: intent.creator, payload: '0xdata' });
    expect(mocks.sonicCreateSwapIntent).toHaveBeenCalledTimes(1);
  });

  it('on a hub-wallet swap (withdraw), validates inputToken against the hub and authorises via sendMessage', async () => {
    const intent = makeIntent(ARBITRUM);
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xhubdata', intent, 7n]);
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xmsgTx' });

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM, {
        inputToken: VAULT, // lsoda* shares are the swap input
        outputToken: SPOKE_TOKEN,
        dstChainKey: ARBITRUM as SpokeChainKey,
        dstAddress: SAMPLE_USER,
      }),
      walletProvider: mockEvmProvider,
      raw: false,
      hubWalletSwap: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tx).toBe('0xmsgTx');
    expect(result.value.intent.feeAmount).toBe(7n);
    // hub-wallet swap routes through sendMessage, and relayData targets the hub wallet.
    expect(sodax.spoke.sendMessage).toHaveBeenCalledTimes(1);
    expect(result.value.relayData).toEqual({ address: HUB_WALLET, payload: '0xhubdata' });
    // the input token is validated against the hub chain, not srcChainKey.
    expect(sodax.config.isValidOriginalAssetAddress).toHaveBeenNthCalledWith(1, HUB, VAULT);
  });

  it('on a Bitcoin hub-wallet swap (withdraw), derives the hub wallet from the trading address but passes the personal srcAddress to sendMessage', async () => {
    // Regression: passing the already-resolved trading address into sendMessage would double-resolve
    // it (SpokeService.sendMessage re-resolves personal→trading internally), so the personal address
    // must flow into sendMessage while only the hub-wallet derivation uses the trading address.
    const TRADING_ADDRESS = 'bc1p-trading-wallet';
    const intent = makeIntent(ChainKeys.BITCOIN_MAINNET);
    const getEffSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValueOnce(TRADING_ADDRESS);
    const ensureSpy = vi.spyOn(sodax.spoke.bitcoin.radfi, 'ensureRadfiAccessToken').mockResolvedValueOnce(undefined);
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xhubdata', intent, 0n]);
    const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xmsgTx' });

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ChainKeys.BITCOIN_MAINNET, {
        inputToken: VAULT, // lsoda* shares are the swap input
        outputToken: SPOKE_TOKEN,
        dstChainKey: ARBITRUM as SpokeChainKey,
        dstAddress: SAMPLE_USER,
      }),
      walletProvider: mockBitcoinProvider,
      raw: false,
      hubWalletSwap: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Personal address is resolved to the trading wallet, and the radfi session is ensured.
    expect(getEffSpy).toHaveBeenCalledWith(SAMPLE_USER);
    expect(ensureSpy).toHaveBeenCalledWith(mockBitcoinProvider);
    // Hub wallet is derived from the trading address (matches what the relay credits).
    expect(mocks.getUserHubWalletAddress).toHaveBeenCalledWith(TRADING_ADDRESS, ChainKeys.BITCOIN_MAINNET);
    // srcAddress stays personal: sendMessage re-resolves the trading address itself, so pre-resolving
    // here would double-resolve (getTradingWallet(tradingAddress) → "Trading wallet not found").
    expect(sendSpy.mock.calls[0]?.[0]?.srcAddress).toBe(SAMPLE_USER);
    expect(result.value.relayData).toEqual({ address: HUB_WALLET, payload: '0xhubdata' });
  });

  it('returns raw tx data without a wallet provider when raw=true', async () => {
    const intent = makeIntent(ARBITRUM);
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xdata', intent, 0n]);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xrawtx' });

    const result = await sodax.leverageYield.createVaultIntent({ params: vaultIntentParams(ARBITRUM), raw: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tx).toBe('0xrawtx');
    expect((sodax.spoke.deposit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].raw).toBe(true);
  });

  it('forwards a per-intent partnerFee override to intent construction (beating config.swaps.partnerFee)', async () => {
    const partnerFee = { address: SAMPLE_USER, percentage: 100 } as const;
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xdata', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });

    await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
      partnerFee,
    });

    expect(mocks.constructCreateIntentData.mock.calls[0]?.[3]).toEqual(partnerFee);
  });

  it('rejects an unsupported input token with VALIDATION_FAILED (field=inputToken)', async () => {
    vi.spyOn(sodax.config, 'isValidOriginalAssetAddress').mockReturnValue(false);

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('inputToken');
  });

  it('rejects an invalid spoke chain with VALIDATION_FAILED (field=srcChainKey)', async () => {
    vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValue(false);

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('srcChainKey');
  });

  it('wraps a non-typed spoke.deposit failure as INTENT_CREATION_FAILED', async () => {
    const depositError = new Error('deposit reverted');
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xdata', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTENT_CREATION_FAILED');
    expect(result.error.cause).toBe(depositError);
  });
});

// ─── vaultSwap — full create → verify → relay → notify-solver orchestration ──

describe('LeverageYieldService.vaultSwap', () => {
  // Stub createVaultIntent so these tests isolate vaultSwap's orchestration.
  const stubCreateVaultIntentOk = (srcChainKey: SpokeChainKey, spokeTxHash = '0xspokeTx') => {
    const intent = makeIntent(srcChainKey as Parameters<typeof getIntentRelayChainId>[0]);
    return vi.spyOn(sodax.leverageYield, 'createVaultIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: spokeTxHash,
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xdata' },
      },
    } as never);
  };

  it('on an EVM spoke source: create → verify → relay → notify-solver, returning delivery info', async () => {
    stubCreateVaultIntentOk(ARBITRUM, '0xspokeTx');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(ARBITRUM, { dstChainKey: ARBITRUM as SpokeChainKey, dstAddress: SAMPLE_USER }),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.solverExecutionResponse).toEqual({ answer: 'OK', intent_hash: '0xhash' });
    expect(result.value.intentDeliveryInfo).toEqual({
      srcChainKey: ARBITRUM,
      srcTxHash: '0xspokeTx',
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      dstTxHash: '0xdstTx',
      dstAddress: SAMPLE_USER,
    });
    expect(mocks.solverPostExecution.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ intent_tx_hash: '0xdstTx' }),
    );
  });

  it('on a Sonic (hub) source: skips relay and notifies the solver with the spoke tx hash', async () => {
    stubCreateVaultIntentOk(SONIC, '0xsonicTx');
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(SONIC, { dstChainKey: ARBITRUM as SpokeChainKey, dstAddress: SAMPLE_USER }),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    expect(result.value.intentDeliveryInfo.dstTxHash).toBe('0xsonicTx');
    expect(mocks.solverPostExecution.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ intent_tx_hash: '0xsonicTx' }),
    );
  });

  it('forwards a createVaultIntent failure unchanged', async () => {
    const createError = new SodaxError('INTENT_CREATION_FAILED', 'boom', { feature: 'leverageYield' });
    vi.spyOn(sodax.leverageYield, 'createVaultIntent').mockResolvedValueOnce({ ok: false, error: createError });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: createError });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('wraps a verifyTxHash failure as TX_VERIFICATION_FAILED (action=vaultSwap)', async () => {
    stubCreateVaultIntentOk(ARBITRUM);
    const verifyError = new Error('verify failed');
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
    expect(result.error.context?.action).toBe('vaultSwap');
    expect(result.error.cause).toBe(verifyError);
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('maps a RELAY_TIMEOUT relay failure to RELAY_TIMEOUT (action=vaultSwap)', async () => {
    stubCreateVaultIntentOk(ARBITRUM);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: new Error('RELAY_TIMEOUT') });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RELAY_TIMEOUT');
    expect(result.error.context?.relayCode).toBe('RELAY_TIMEOUT');
    expect(result.error.context?.action).toBe('vaultSwap');
    expect(mocks.solverPostExecution).not.toHaveBeenCalled();
  });

  it('propagates a solver postExecution error as EXTERNAL_API_ERROR with solverCode', async () => {
    stubCreateVaultIntentOk(SONIC);
    const detail = { code: -7, message: 'no execution module found' };
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: false, error: { detail } });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(SONIC),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXTERNAL_API_ERROR');
    expect(result.error.context?.solverCode).toBe(-7);
    expect(result.error.context?.phase).toBe('postExecution');
  });
});

// ─── notifySolver — public manual-orchestration notify step ────────────────

describe('LeverageYieldService.notifySolver', () => {
  it('returns the solver acknowledgement on success (manual create → relay → notify path)', async () => {
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });

    const result = await sodax.leverageYield.notifySolver({ intent_tx_hash: '0xhubIntentTx' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ answer: 'OK', intent_hash: '0xhash' });
    expect(mocks.solverPostExecution.mock.calls[0]?.[0]).toEqual({ intent_tx_hash: '0xhubIntentTx' });
  });

  it('maps a solver error response to EXTERNAL_API_ERROR with solverCode', async () => {
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: false, error: { detail: { code: -7, message: 'boom' } } });

    const result = await sodax.leverageYield.notifySolver({ intent_tx_hash: '0xhubIntentTx' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXTERNAL_API_ERROR');
    expect(result.error.context?.solverCode).toBe(-7);
    expect(result.error.context?.phase).toBe('postExecution');
  });
});

// ─── approve / isAllowanceValid — Sonic-direct underlying-asset allowance ──

describe('LeverageYieldService.approve', () => {
  it('resolves the vault asset and approves it to the vault (non-raw)', async () => {
    stubReadContract({ asset: SODA_ASSET });
    mocks.erc20Approve.mockResolvedValueOnce('0xapproveTx');

    const result = await sodax.leverageYield.approve({ vault: VAULT, amount: 100n, walletProvider: mockEvmProvider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('0xapproveTx');
    expect(mocks.erc20Approve.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ token: SODA_ASSET, spender: VAULT, from: SAMPLE_USER, amount: 100n, raw: false }),
    );
  });

  it('clears a stale allowance first when the vault asset needs it', async () => {
    stubReadContract({ asset: SODA_ASSET });
    mocks.erc20PlanApproval.mockResolvedValueOnce({ resetAmount: 0n, approveAmount: 100n, reason: 'reset-required' });
    mocks.erc20Approve.mockResolvedValueOnce('0xresetTx').mockResolvedValueOnce('0xapproveTx');
    vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValue({
      ok: true,
      value: { status: 'success', receipt: {} },
    } as never);

    const result = await sodax.leverageYield.approve({ vault: VAULT, amount: 100n, walletProvider: mockEvmProvider });

    // Routing through SpokeService is what buys this — a direct Erc20Service.approve would
    // dead-end on a USDT-class asset.
    expect(result).toEqual({ ok: true, value: '0xapproveTx' });
    expect(mocks.erc20Approve).toHaveBeenCalledTimes(2);
    expect(mocks.erc20Approve.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ amount: 0n }));
  });

  it('returns raw approve tx data when raw=true', async () => {
    stubReadContract({ asset: SODA_ASSET });
    mocks.erc20Approve.mockResolvedValueOnce('0xrawApprove');

    const result = await sodax.leverageYield.approve({
      vault: VAULT,
      amount: 100n,
      walletProvider: mockEvmProvider,
      raw: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('0xrawApprove');
    expect(mocks.erc20Approve.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ raw: true }));
  });

  it('rejects a non-positive amount with VALIDATION_FAILED (field=amount)', async () => {
    const result = await sodax.leverageYield.approve({ vault: VAULT, amount: 0n, walletProvider: mockEvmProvider });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('amount');
    expect(mocks.erc20Approve).not.toHaveBeenCalled();
  });

  it('wraps a getAsset failure as APPROVE_FAILED', async () => {
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('asset read failed'));

    const result = await sodax.leverageYield.approve({ vault: VAULT, amount: 100n, walletProvider: mockEvmProvider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('APPROVE_FAILED');
    expect(mocks.erc20Approve).not.toHaveBeenCalled();
  });
});

describe('LeverageYieldService.isAllowanceValid', () => {
  it('returns true when the on-chain allowance covers the amount', async () => {
    stubReadContract({ asset: SODA_ASSET, allowance: 100n });
    const result = await sodax.leverageYield.isAllowanceValid({ vault: VAULT, amount: 50n, owner: SAMPLE_USER });
    expect(result).toEqual({ ok: true, value: true });
  });

  it('returns false when the on-chain allowance is short', async () => {
    stubReadContract({ asset: SODA_ASSET, allowance: 100n });
    const result = await sodax.leverageYield.isAllowanceValid({ vault: VAULT, amount: 150n, owner: SAMPLE_USER });
    expect(result).toEqual({ ok: true, value: false });
  });

  it('rejects a non-positive amount with VALIDATION_FAILED (action=allowanceCheck)', async () => {
    const result = await sodax.leverageYield.isAllowanceValid({ vault: VAULT, amount: 0n, owner: SAMPLE_USER });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.action).toBe('allowanceCheck');
  });

  it('wraps a getAsset failure as ALLOWANCE_CHECK_FAILED', async () => {
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('asset read failed'));
    const result = await sodax.leverageYield.isAllowanceValid({ vault: VAULT, amount: 50n, owner: SAMPLE_USER });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ALLOWANCE_CHECK_FAILED');
  });
});

// ─── getMaxWithdrawForUser — hub-wallet resolution + dust-buffer clamp ──

describe('LeverageYieldService.getMaxWithdrawForUser', () => {
  it('trims MAX_WITHDRAW_DUST_BUFFER (1000) from the on-chain maxWithdraw', async () => {
    mocks.erc4626GetMaxWithdraw.mockResolvedValueOnce({ ok: true, value: 10_000n });
    const result = await sodax.leverageYield.getMaxWithdrawForUser(VAULT, ARBITRUM, SAMPLE_USER);
    expect(result).toEqual({ ok: true, value: 9_000n });
    expect(mocks.erc4626GetMaxWithdraw.mock.calls[0]?.slice(0, 2)).toEqual([VAULT, HUB_WALLET]);
  });

  it('clamps to 0 when maxWithdraw is below the dust buffer (no underflow)', async () => {
    mocks.erc4626GetMaxWithdraw.mockResolvedValueOnce({ ok: true, value: 500n });
    const result = await sodax.leverageYield.getMaxWithdrawForUser(VAULT, ARBITRUM, SAMPLE_USER);
    expect(result).toEqual({ ok: true, value: 0n });
  });

  it('propagates the inner getMaxWithdraw LOOKUP_FAILED (method=getMaxWithdraw)', async () => {
    mocks.erc4626GetMaxWithdraw.mockResolvedValueOnce({ ok: false, error: new Error('maxWithdraw revert') });
    const result = await sodax.leverageYield.getMaxWithdrawForUser(VAULT, ARBITRUM, SAMPLE_USER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('getMaxWithdraw');
  });

  it('wraps a hub-wallet resolution failure as LOOKUP_FAILED (method=getMaxWithdrawForUser, with srcChainKey)', async () => {
    mocks.getUserHubWalletAddress.mockReset();
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(new Error('hub wallet derivation failed'));
    const result = await sodax.leverageYield.getMaxWithdrawForUser(VAULT, ARBITRUM, SAMPLE_USER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('getMaxWithdrawForUser');
    expect(result.error.context?.srcChainKey).toBe(ARBITRUM);
  });
});

// ─── Representative reads — tuple decode, balanceOf, Erc4626 delegation ──

describe('LeverageYieldService reads', () => {
  it('getPosition decodes the getPositionDetails tuple into named fields', async () => {
    stubReadContract({ position: [1n, 2n, 3n, 4n, 5n] });
    const result = await sodax.leverageYield.getPosition(VAULT);
    expect(result).toEqual({ ok: true, value: { collateral: 1n, debt: 2n, ltv: 3n, healthFactor: 4n, idleAsset: 5n } });
  });

  it('getShareBalance reads balanceOf(owner)', async () => {
    stubReadContract({ balance: 777n });
    const result = await sodax.leverageYield.getShareBalance(VAULT, SAMPLE_USER);
    expect(result).toEqual({ ok: true, value: 777n });
  });

  it('getShareBalanceForUser resolves the hub wallet then reads its balance', async () => {
    stubReadContract({ balance: 888n });
    const result = await sodax.leverageYield.getShareBalanceForUser(VAULT, ARBITRUM, SAMPLE_USER);
    expect(result).toEqual({ ok: true, value: 888n });
  });

  it('getTotalAssets delegates to Erc4626Service and forwards the value', async () => {
    mocks.erc4626GetTotalAssets.mockResolvedValueOnce({ ok: true, value: 5_000n });
    const result = await sodax.leverageYield.getTotalAssets(VAULT);
    expect(result).toEqual({ ok: true, value: 5_000n });
  });

  it('getTotalAssets maps an Erc4626 failure to LOOKUP_FAILED (method=getTotalAssets)', async () => {
    mocks.erc4626GetTotalAssets.mockResolvedValueOnce({ ok: false, error: new Error('totalAssets revert') });
    const result = await sodax.leverageYield.getTotalAssets(VAULT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('getTotalAssets');
  });

  it('previewDeposit / previewWithdraw / previewRedeem forward the Erc4626 value', async () => {
    mocks.erc4626PreviewDeposit.mockResolvedValueOnce({ ok: true, value: 11n });
    mocks.erc4626PreviewWithdraw.mockResolvedValueOnce({ ok: true, value: 22n });
    mocks.erc4626PreviewRedeem.mockResolvedValueOnce({ ok: true, value: 33n });

    expect(await sodax.leverageYield.previewDeposit(VAULT, 100n)).toEqual({ ok: true, value: 11n });
    expect(await sodax.leverageYield.previewWithdraw(VAULT, 100n)).toEqual({ ok: true, value: 22n });
    expect(await sodax.leverageYield.previewRedeem(VAULT, 100n)).toEqual({ ok: true, value: 33n });
  });

  it('previewRedeem maps an Erc4626 failure to LOOKUP_FAILED (method=previewRedeem)', async () => {
    mocks.erc4626PreviewRedeem.mockResolvedValueOnce({ ok: false, error: new Error('previewRedeem revert') });
    const result = await sodax.leverageYield.previewRedeem(VAULT, 100n);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('previewRedeem');
  });
});

// ─── Additional error-path coverage ──────────────────────────────────────

describe('LeverageYieldService — additional error paths', () => {
  it('getEffectiveApr propagates a getApr failure (LOOKUP_FAILED, method=getApr)', async () => {
    // getEffectiveApr awaits getApr + getLsdApr together; the failing fetch hits the retry
    // back-off, so fake timers keep the test fast.
    vi.useFakeTimers();
    vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('rpc down'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network'))); // getLsdApr falls back (ok)

    const promise = sodax.leverageYield.getEffectiveApr(VAULT);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('getApr');
  });

  it('createVaultIntent wraps a hub-wallet sendMessage failure as INTENT_CREATION_FAILED', async () => {
    const sendError = new Error('sendMessage reverted');
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xhubdata', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM, {
        inputToken: VAULT,
        outputToken: SPOKE_TOKEN,
        dstChainKey: ARBITRUM as SpokeChainKey,
        dstAddress: SAMPLE_USER,
      }),
      walletProvider: mockEvmProvider,
      raw: false,
      hubWalletSwap: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTENT_CREATION_FAILED');
    expect(result.error.cause).toBe(sendError);
  });

  it('vaultSwap surfaces a malformed solver response as EXTERNAL_API_ERROR with a synthetic solverCode', async () => {
    const intent = makeIntent(SONIC);
    vi.spyOn(sodax.leverageYield, 'createVaultIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xsonicTx',
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xdata' },
      },
    } as never);
    // postExecution returns a failure with no `detail` — notifySolver substitutes a synthetic one.
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: false, error: {} });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(SONIC),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXTERNAL_API_ERROR');
    expect(result.error.context?.solverCode).toBe(-999);
  });
});
