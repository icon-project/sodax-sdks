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
import { decodeAbiParameters, type Address, type Hex } from 'viem';
import { leverageYieldConfig } from '@sodax/types';
// Import the barrel by relative path, not as `@sodax/sdk`. A self-referential package import
// resolves through `package.json#exports` into `dist/`, which makes this unit test depend on a
// build artifact — it then fails to resolve whenever `dist/` is absent or half-written, and turbo
// can cache that state. Every other test in this package imports `../index.js`; keep it that way.
import {
  ChainKeys,
  getIntentRelayChainId,
  type IBitcoinWalletProvider,
  type IEvmWalletProvider,
  isSodaxError,
  type PartnerFee,
  type SodaxOptions,
  type SpokeChainKey,
} from '../index.js';
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
  solverGetQuote: vi.fn(),
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
  SolverApiService: { postExecution: mocks.solverPostExecution, getQuote: mocks.solverGetQuote },
}));
vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return { ...actual, relayTxAndWaitPacket: mocks.relayTxAndWaitPacket };
});
vi.mock('../shared/services/erc-20/Erc20Service.js', async () => {
  const actual = await vi.importActual<typeof import('../shared/services/erc-20/Erc20Service.js')>(
    '../shared/services/erc-20/Erc20Service.js',
  );
  return {
    ...actual,
    Erc20Service: {
      approve: mocks.erc20Approve,
      planApproval: mocks.erc20PlanApproval,
      // Left real: the position payload builders encode approvals and the funding transfer into the
      // batch the hub wallet executes, and asserting that batch's shape is the point of those tests.
      encodeApprove: actual.Erc20Service.encodeApprove,
      encodeTransfer: actual.Erc20Service.encodeTransfer,
    },
  };
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

  it('forwards a caller-supplied partnerFee on the payload (per-intent override)', async () => {
    const partnerFee = { address: SAMPLE_USER, percentage: 100 } as const;

    const result = await sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      partnerFee,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.partnerFee).toEqual(partnerFee);
  });

  // Backward compatibility: pre-existing callers pass no partnerFee, so the key must stay absent
  // and `createVaultIntent`'s default must keep resolving the configured leverage-yield fee.
  it('omits partnerFee from the payload when the caller does not supply one', async () => {
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
    expect('partnerFee' in result.value).toBe(false);
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

  it('forwards a per-intent partnerFee override to intent construction', async () => {
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

// ─── Partner-fee precedence ───────────────────────────────────────────────

/**
 * Vault intents are priced off the effective **leverage-yield** fee
 * (`leverageYield.partnerFee ?? fee`), never the swap fee. Regression cover for the period
 * when `createVaultIntent` read `config.swapPartnerFee`, which silently applied `swaps.partnerFee`
 * to vault flows and made `leverageYield.partnerFee` a no-op.
 */
describe('LeverageYieldService — partner-fee precedence', () => {
  const LY_FEE = { address: SAMPLE_USER, percentage: 100 } as const satisfies PartnerFee;
  const SWAP_FEE = { address: HUB_WALLET, percentage: 50 } as const satisfies PartnerFee;
  const GLOBAL_FEE = { address: POOL, percentage: 25 } as const satisfies PartnerFee;

  // Each precedence case needs its own instance: the fee is resolved from config at call time.
  // Re-applies the stubs `beforeEach` installs on the module-level `sodax`.
  const makeSodax = (options: SodaxOptions): Sodax => {
    const s = new Sodax(options);
    vi.spyOn(s.config, 'isValidOriginalAssetAddress').mockReturnValue(true);
    vi.spyOn(s.config, 'isValidSpokeChainKey').mockReturnValue(true);
    vi.spyOn(s.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    return s;
  };

  /** Runs the EVM-spoke deposit branch and returns the fee handed to intent construction. */
  const feeForDeposit = async (s: Sodax, overrides: { partnerFee?: PartnerFee } = {}) => {
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xdata', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(s.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    await s.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
      ...overrides,
    });
    return mocks.constructCreateIntentData.mock.calls[0]?.[3];
  };

  it('applies the configured leverageYield.partnerFee', async () => {
    expect(await feeForDeposit(makeSodax({ leverageYield: { partnerFee: LY_FEE } }))).toEqual(LY_FEE);
  });

  it('ignores swaps.partnerFee — the swap fee never applies to vault intents', async () => {
    expect(await feeForDeposit(makeSodax({ swaps: { partnerFee: SWAP_FEE } }))).toBeUndefined();
    // `calls[0]?.[3]` is also undefined when the mock was never called, so an early bail-out in
    // createVaultIntent would pass the assertion above vacuously. Pin that the branch was reached.
    expect(mocks.constructCreateIntentData).toHaveBeenCalledTimes(1);
  });

  it('leverageYield.partnerFee wins over swaps.partnerFee when both are set', async () => {
    const s = makeSodax({ swaps: { partnerFee: SWAP_FEE }, leverageYield: { partnerFee: LY_FEE } });
    expect(await feeForDeposit(s)).toEqual(LY_FEE);
  });

  it('falls back to the global fee when leverageYield.partnerFee is unset', async () => {
    expect(await feeForDeposit(makeSodax({ fee: GLOBAL_FEE }))).toEqual(GLOBAL_FEE);
  });

  it('leverageYield.partnerFee beats the global fee', async () => {
    expect(await feeForDeposit(makeSodax({ fee: GLOBAL_FEE, leverageYield: { partnerFee: LY_FEE } }))).toEqual(LY_FEE);
  });

  it('a per-intent partnerFee beats the configured leverageYield.partnerFee', async () => {
    const perIntent = { address: HUB_WALLET, percentage: 10 } as const satisfies PartnerFee;
    const s = makeSodax({ leverageYield: { partnerFee: LY_FEE } });
    expect(await feeForDeposit(s, { partnerFee: perIntent })).toEqual(perIntent);
  });

  it('applies the leverage-yield fee on the Sonic-source branch', async () => {
    const s = makeSodax({ swaps: { partnerFee: SWAP_FEE }, leverageYield: { partnerFee: LY_FEE } });
    mocks.sonicCreateSwapIntent.mockResolvedValueOnce(['0xsonicTx', makeIntent(SONIC), 0n, '0xdata']);

    await s.leverageYield.createVaultIntent({
      params: vaultIntentParams(SONIC),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(mocks.sonicCreateSwapIntent.mock.calls[0]?.[0].fee).toEqual(LY_FEE);
  });

  it('applies the leverage-yield fee on the hub-wallet-swap (withdraw) branch', async () => {
    const s = makeSodax({ swaps: { partnerFee: SWAP_FEE }, leverageYield: { partnerFee: LY_FEE } });
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xhubdata', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(s.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xmsgTx' });

    await s.leverageYield.createVaultIntent({
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

    expect(mocks.constructCreateIntentData.mock.calls[0]?.[3]).toEqual(LY_FEE);
  });
});

// ─── getQuote — vault-fee-aware solver quote ──────────────────────────────

describe('LeverageYieldService.getQuote', () => {
  const LY_FEE = { address: SAMPLE_USER, percentage: 100 } as const satisfies PartnerFee; // 1%
  const SWAP_FEE = { address: HUB_WALLET, percentage: 50 } as const satisfies PartnerFee;

  const quoteParams = {
    token_src: SPOKE_TOKEN,
    token_src_blockchain_id: ARBITRUM,
    token_dst: VAULT,
    token_dst_blockchain_id: HUB as SpokeChainKey,
    amount: 1_000_000n,
    quote_type: 'exact_input',
  } as const;

  /** Amount actually forwarded to the solver, i.e. gross minus the fee applied by getQuote. */
  const quotedAmount = async (s: Sodax, overrides: { partnerFee?: PartnerFee } = {}) => {
    mocks.solverGetQuote.mockResolvedValueOnce({ ok: true, value: { quoted_amount: 1n } });
    await s.leverageYield.getQuote({ ...quoteParams, ...overrides });
    expect(mocks.solverGetQuote).toHaveBeenCalledTimes(1);
    return mocks.solverGetQuote.mock.calls[0]?.[0].amount;
  };

  it('deducts the configured leverageYield.partnerFee before quoting', async () => {
    const amount = await quotedAmount(new Sodax({ leverageYield: { partnerFee: LY_FEE } }));
    expect(amount).toBe(990_000n); // 1% of 1_000_000
  });

  it('deducts nothing when no leverage-yield or global fee is configured', async () => {
    expect(await quotedAmount(new Sodax())).toBe(1_000_000n);
  });

  it('ignores swaps.partnerFee — matches what the vault intent will charge, not the swap fee', async () => {
    expect(await quotedAmount(new Sodax({ swaps: { partnerFee: SWAP_FEE } }))).toBe(1_000_000n);
  });

  it('honours a per-call partnerFee override', async () => {
    const s = new Sodax({ leverageYield: { partnerFee: LY_FEE } });
    const amount = await quotedAmount(s, { partnerFee: { address: HUB_WALLET, percentage: 10 } });
    expect(amount).toBe(999_000n); // 0.1% of 1_000_000
  });

  it('forwards the request fields unchanged and returns the solver response', async () => {
    const s = new Sodax();
    mocks.solverGetQuote.mockResolvedValueOnce({ ok: true, value: { quoted_amount: 4_242n } });
    const result = await s.leverageYield.getQuote(quoteParams);

    expect(result).toEqual({ ok: true, value: { quoted_amount: 4_242n } });
    const [forwarded, solverConfig] = mocks.solverGetQuote.mock.calls[0] ?? [];
    // partnerFee is stripped; every other field reaches the solver verbatim.
    expect(forwarded).toEqual({ ...quoteParams });
    expect(forwarded).not.toHaveProperty('partnerFee');
    // The instance under test, not the module-level `sodax`: deepMerge happens to share the
    // `solver` sub-object across instances, so asserting the other one would pass vacuously.
    expect(solverConfig).toBe(s.config.solver);
  });

  it('propagates a solver error Result instead of throwing', async () => {
    const error = { detail: { code: -4, message: 'no path' } };
    mocks.solverGetQuote.mockResolvedValueOnce({ ok: false, error });

    const result = await new Sodax().leverageYield.getQuote(quoteParams);

    expect(result).toEqual({ ok: false, error });
  });

  // The other LY methods return a Result for bad input; getQuote must not be the one that throws.
  it('returns VALIDATION_FAILED for a non-positive amount rather than rejecting', async () => {
    const result = await new Sodax().leverageYield.getQuote({ ...quoteParams, amount: 0n });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.solverGetQuote).not.toHaveBeenCalled();
  });

  // A fee that leaves nothing to quote is an input/config problem, not a lookup failure — the
  // underlying fee arithmetic throws a bare invariant, which would otherwise be wrapped as
  // LOOKUP_FAILED and rendered as a retryable network-ish error.
  it('returns VALIDATION_FAILED when a fixed partner fee exceeds the quote amount', async () => {
    const s = new Sodax({ leverageYield: { partnerFee: { address: SAMPLE_USER, amount: 2_000_000n } } });

    const result = await s.leverageYield.getQuote(quoteParams); // amount is 1_000_000n

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.solverGetQuote).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_FAILED when a fixed partner fee equals the quote amount', async () => {
    const s = new Sodax({ leverageYield: { partnerFee: { address: SAMPLE_USER, amount: 1_000_000n } } });

    const result = await s.leverageYield.getQuote(quoteParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.solverGetQuote).not.toHaveBeenCalled();
  });

  it.each([
    ['above the 10_000 bp scale', 20_000],
    ['negative', -5],
    // Fractional passes calculateFeeAmount's bounds check, then BigInt(0.5) throws a RangeError.
    ['fractional', 0.5],
  ])('returns VALIDATION_FAILED for a %s percentage fee', async (_label, percentage) => {
    const s = new Sodax({ leverageYield: { partnerFee: { address: SAMPLE_USER, percentage } } });

    const result = await s.leverageYield.getQuote(quoteParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.solverGetQuote).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_FAILED when a 100% percentage fee consumes the whole amount', async () => {
    const s = new Sodax({ leverageYield: { partnerFee: { address: SAMPLE_USER, percentage: 10_000 } } });

    const result = await s.leverageYield.getQuote(quoteParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.solverGetQuote).not.toHaveBeenCalled();
  });

  it('tags error context with token-side chain keys, not srcChainKey/dstChainKey', async () => {
    const result = await new Sodax().leverageYield.getQuote({ ...quoteParams, amount: 0n });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (!isSodaxError(result.error)) throw new Error('expected a SodaxError');
    // A withdraw quote's token_src lives on the hub, so `srcChainKey` would misreport the chain
    // the user signs on. Neutral names keep the field meanings intact across both directions.
    expect(result.error.context).toMatchObject({
      method: 'getQuote',
      tokenSrcChainKey: ARBITRUM,
      tokenDstChainKey: HUB,
    });
    expect(result.error.context).not.toHaveProperty('srcChainKey');
  });

  it('returns LOOKUP_FAILED when the solver call rejects (unsupported token)', async () => {
    // SolverApiService asserts its own preconditions as a rejection — it must not escape getQuote.
    mocks.solverGetQuote.mockRejectedValueOnce(new Error('unsupported token_src for src chain'));

    const result = await new Sodax().leverageYield.getQuote(quoteParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('LOOKUP_FAILED');
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

// ─── Partner-fee precedence, end to end through both builders ─────────────

/**
 * The precedence chain is `per-intent ?? leverageYield.partnerFee ?? global fee ?? none`, resolved
 * at a single point in `createVaultIntent`. These cases drive it through the **builders** —
 * `deposit()` and `withdraw()` — because that hop is what differs per flow: each must forward a
 * caller fee onto the payload and leave the key absent otherwise. Every case also sets
 * `swaps.partnerFee` to a distinct value it must never pick up.
 */
describe('LeverageYieldService — partner-fee precedence end to end', () => {
  const PARAM = { address: SAMPLE_USER, percentage: 10 } as const satisfies PartnerFee;
  const FEATURE = { address: HUB_WALLET, percentage: 100 } as const satisfies PartnerFee;
  const GLOBAL = { address: POOL, percentage: 25 } as const satisfies PartnerFee;
  const SWAPS = { address: BORROW_TOKEN, percentage: 77 } as const satisfies PartnerFee;

  const mk = (o: SodaxOptions) => {
    const s = new Sodax(o);
    vi.spyOn(s.config, 'isValidOriginalAssetAddress').mockReturnValue(true);
    vi.spyOn(s.config, 'isValidSpokeChainKey').mockReturnValue(true);
    vi.spyOn(s.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(s.hubProvider.publicClient, 'getBlock').mockResolvedValue({ timestamp: 1n } as never);
    return s;
  };

  const runDeposit = async (o: SodaxOptions, partnerFee?: PartnerFee) => {
    const s = mk(o);
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xd', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(s.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xtx' });
    const built = await s.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      ...(partnerFee && { partnerFee }),
    });
    if (!built.ok) throw new Error('deposit build failed');
    await s.leverageYield.createVaultIntent({ ...built.value, walletProvider: mockEvmProvider, raw: false });
    expect(mocks.constructCreateIntentData).toHaveBeenCalledTimes(1);
    return mocks.constructCreateIntentData.mock.calls[0]?.[3];
  };

  const runWithdraw = async (o: SodaxOptions, partnerFee?: PartnerFee) => {
    const s = mk(o);
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xd', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(s.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xmsg' });
    const built = await s.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      ...(partnerFee && { partnerFee }),
    });
    if (!built.ok) throw new Error('withdraw build failed');
    await s.leverageYield.createVaultIntent({ ...built.value, walletProvider: mockEvmProvider, raw: false });
    expect(mocks.constructCreateIntentData).toHaveBeenCalledTimes(1);
    return mocks.constructCreateIntentData.mock.calls[0]?.[3];
  };

  for (const [name, run] of [
    ['deposit', runDeposit],
    ['withdraw', runWithdraw],
  ] as const) {
    it(`${name}: 1) param fee wins over feature + global + swaps`, async () => {
      expect(
        await run({ fee: GLOBAL, swaps: { partnerFee: SWAPS }, leverageYield: { partnerFee: FEATURE } }, PARAM),
      ).toEqual(PARAM);
    });
    it(`${name}: 2) feature fee wins over global + swaps`, async () => {
      expect(await run({ fee: GLOBAL, swaps: { partnerFee: SWAPS }, leverageYield: { partnerFee: FEATURE } })).toEqual(
        FEATURE,
      );
    });
    it(`${name}: 3) global fee applies when feature unset`, async () => {
      expect(await run({ fee: GLOBAL, swaps: { partnerFee: SWAPS } })).toEqual(GLOBAL);
    });
    it(`${name}: 4) no fee when nothing configured`, async () => {
      expect(await run({ swaps: { partnerFee: SWAPS } })).toBeUndefined();
    });
  }
});

// ── Leverage positions ────────────────────────────────────────────────────────
//
// Positions are the unpooled counterpart to the vaults above. The deployed factory ships as a
// packaged default, so the tests cover both halves of that: the default resolving with nothing
// configured, and a blanked-out override still failing closed rather than reaching for a
// placeholder.

const POSITION = '0x1111111111111111111111111111111111111111' as Address;
const POSITION_OWNER = '0x2222222222222222222222222222222222222222' as Address;
const POSITION_FACTORY = '0x3333333333333333333333333333333333333333' as Address;
const POS_COLLATERAL = '0x243b0c26c8b38793908d7C64e8510f21B19B4613' as Address;
const POS_BORROW_TOKEN = '0xb780e09576C2667ba9F5B80FbAb2e6b8A0a21e37' as Address;

/** A Sodax instance with the position factory configured, for the happy paths. */
function sodaxWithFactory(): Sodax {
  return new Sodax({ leverageYield: { positionFactory: POSITION_FACTORY } });
}

/**
 * The factory now ships in `leverageYieldConfig`, so "not configured" is only reachable by
 * overriding it with an empty value — which is exactly what a bad env var produces.
 */
function sodaxWithoutFactory(): Sodax {
  return new Sodax({ leverageYield: { positionFactory: '' as Address } });
}

describe('LeverageYieldService.approvePositionFunding — waiting for the approve to land', () => {
  /**
   * The whole point of this method over a bare `spoke.approve`. `spoke.verifyTxHash` returns
   * `{ ok: true }` for EVM WITHOUT waiting, so relying on it left the caller's next allowance read
   * seeing the pre-approval value — the live symptom was being asked to approve twice.
   */
  it('waits on the EVM provider receipt, not on verifyTxHash', async () => {
    vi.spyOn(sodax.spoke, 'approve').mockResolvedValue({ ok: true, value: '0xapproveTx' } as never);
    const verify = vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    const wait = mockEvmProvider.waitForTransactionReceipt as ReturnType<typeof vi.fn>;
    wait.mockResolvedValueOnce({} as never);

    const result = await sodax.leverageYield.approvePositionFunding({
      srcChainKey: 'sonic',
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 100n,
      walletProvider: mockEvmProvider as never,
    });

    expect(result).toEqual({ ok: true, value: '0xapproveTx' });
    expect(wait).toHaveBeenCalledWith('0xapproveTx');
    // The non-waiting path must NOT be what gates the return on EVM.
    expect(verify).not.toHaveBeenCalled();
  });

  it('falls back to verifyTxHash for a non-EVM provider, and fails closed when it reports failure', async () => {
    vi.spyOn(sodax.spoke, 'approve').mockResolvedValue({ ok: true, value: '0xapproveTx' } as never);
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({
      ok: false,
      error: new Error('reverted'),
    } as never);

    const result = await sodax.leverageYield.approvePositionFunding({
      srcChainKey: 'sonic',
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 100n,
      walletProvider: mockBitcoinProvider as never,
    });

    expect(result.ok).toBe(false);
  });

  it('rejects a non-positive amount before touching the wallet', async () => {
    const approve = vi.spyOn(sodax.spoke, 'approve');
    const result = await sodax.leverageYield.approvePositionFunding({
      srcChainKey: 'sonic',
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 0n,
      walletProvider: mockEvmProvider as never,
    });
    expect(result.ok).toBe(false);
    expect(approve).not.toHaveBeenCalled();
  });
});

describe('LeverageYieldService — positions, factory misconfigured', () => {
  it('uses the deployed factory straight from the default config, with nothing supplied', () => {
    const result = new Sodax().leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 3,
      origin: { chainKey: 'sonic', address: POSITION_OWNER },
      initialAssets: 1n,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.to).toBe(leverageYieldConfig.positionFactory);
  });

  it('still honours an explicit override, for a fork or a staging deployment', () => {
    const result = sodaxWithFactory().leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 3,
      origin: { chainKey: 'sonic', address: POSITION_OWNER },
      initialAssets: 1n,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.to).toBe(POSITION_FACTORY);
    expect(result.value.to).not.toBe(leverageYieldConfig.positionFactory);
  });

  it('listPositions fails closed rather than using a placeholder address', async () => {
    const result = await sodaxWithoutFactory().leverageYield.listPositions(POSITION_OWNER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });

  it('predictPosition fails closed', async () => {
    const result = await sodaxWithoutFactory().leverageYield.predictPosition(POSITION_OWNER, POSITION_OWNER);
    expect(result.ok).toBe(false);
  });

  it('maps the origin chain key to its SODAX relay id, not the EVM one', () => {
    const configured = sodaxWithFactory();
    const result = configured.leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 0,
      // Arbitrum is 23 in the relay id space; 42161 would route a refund nowhere.
      origin: { chainKey: '0xa4b1.arbitrum', address: POSITION_OWNER, asset: POS_BORROW_TOKEN },
      initialAssets: 10n ** 18n,
      borrowAmount: 1_000n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 23 padded into the calldata word for originChainId.
    expect(result.value.data).toContain((23).toString(16).padStart(64, '0'));
    expect(result.value.data).not.toContain((42161).toString(16).padStart(64, '0'));
  });

  it('refuses a spoke origin with no refund asset', () => {
    const configured = sodaxWithFactory();
    const result = configured.leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 0,
      // Off-hub with nothing to unwrap into: the AssetManager moves only its own registered assets,
      // so this would be a position whose refund could never be paid.
      origin: { chainKey: '0xa4b1.arbitrum', address: POSITION_OWNER },
      initialAssets: 10n ** 18n,
      borrowAmount: 1_000n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(false);
  });

  it('buildCreatePositionAndLeverage fails closed', () => {
    const result = sodaxWithoutFactory().leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 3,
      origin: { chainKey: 'sonic', address: POSITION_OWNER },
      initialAssets: 1n,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(false);
  });

  it('position-only reads do not need the factory', async () => {
    // `sodax` has no factory configured, but this read targets the position directly, so it
    // must still resolve — only factory-backed methods are gated.
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockResolvedValue(true as never);
    const result = await sodax.leverageYield.getPositionPendingState(POSITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isLive).toBe(true);
  });

  it('flags a resolved-but-unswept slot as needing settlement', async () => {
    // The state that strands funds: an operation is recorded but its intent is gone, so the grant
    // is still open and any debt-side contribution is still sitting in the position.
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockImplementation((async ({
      functionName,
    }: {
      functionName: string;
    }) => (functionName === 'hasPendingOperation' ? false : 3)) as never);

    const result = await sodax.leverageYield.getPositionPendingState(POSITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ kind: 3, isLive: false, needsSettle: true });
  });
});

describe('LeverageYieldService — position reads', () => {
  it('listPositions returns the owner clones in creation order', async () => {
    const configured = sodaxWithFactory();
    const positions = [POSITION, '0x4444444444444444444444444444444444444444'] as const;
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockResolvedValue(positions as never);

    const result = await configured.leverageYield.listPositions(POSITION_OWNER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(positions);
  });

  it('getPositionInfo assembles the static descriptor', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
      functionName: string;
    }) => {
      switch (call.functionName) {
        case 'owner':
          return POSITION_OWNER;
        case 'collateral':
          return POS_COLLATERAL;
        case 'borrowToken':
          return POS_BORROW_TOKEN;
        case 'eModeCategory':
          return 3;
        default:
          throw new Error(`unexpected read: ${call.functionName}`);
      }
    }) as never);

    const result = await configured.leverageYield.getPositionInfo(POSITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      address: POSITION,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 3,
    });
  });

  it('getPositionAccount reads getUserAccountData against the configured lending pool', async () => {
    const configured = sodaxWithFactory();
    const accountData = [1000n, 400n, 200n, 9700n, 9100n, 1_066_000_000_000_000_000n] as const;
    const calls: { functionName: string; address: Address }[] = [];
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
      functionName: string;
      address: Address;
    }) => {
      calls.push({ functionName: call.functionName, address: call.address });
      if (call.functionName === 'getUserAccountData') return accountData;
      throw new Error(`unexpected read: ${call.functionName}`);
    }) as never);

    const result = await configured.leverageYield.getPositionAccount(POSITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // One round trip, against the pool from config — not the position's own pool() getter.
    expect(calls).toEqual([
      { functionName: 'getUserAccountData', address: configured.config.sodaxConfig.moneyMarket.lendingPool },
    ]);
    expect(result.value.healthFactor).toBe(1_066_000_000_000_000_000n);
    expect(result.value.currentLiquidationThreshold).toBe(9700n);
  });

  it('wraps a read failure as LOOKUP_FAILED', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('rpc down'));
    const result = await configured.leverageYield.getPositionInfo(POSITION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });

  it('getPositionCollateralBalance reads the aToken balance, taking the reserve from the configured pool', async () => {
    const configured = sodaxWithFactory();
    const aToken = '0x00000000000000000000000000000000000000a1' as Address;
    const calls: { functionName: string; address: Address; args?: readonly unknown[] }[] = [];
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
      functionName: string;
      address: Address;
      args?: readonly unknown[];
    }) => {
      calls.push({ functionName: call.functionName, address: call.address, args: call.args });
      if (call.functionName === 'getReserveData') return { aTokenAddress: aToken };
      if (call.functionName === 'balanceOf') return 4_200n;
      throw new Error(`unexpected read: ${call.functionName}`);
    }) as never);

    const result = await configured.leverageYield.getPositionCollateralBalance(POSITION, POS_COLLATERAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ aToken, balance: 4_200n });
    // The reserve lookup goes to the pool from config; the balance is read off the aToken it names,
    // for the position — not for the owner, which holds none of it.
    expect(calls).toEqual([
      {
        functionName: 'getReserveData',
        address: configured.config.sodaxConfig.moneyMarket.lendingPool,
        args: [POS_COLLATERAL],
      },
      { functionName: 'balanceOf', address: aToken, args: [POSITION] },
    ]);
  });

  it('getPositionCollateralBalance resolves the collateral off the position when not given one', async () => {
    const configured = sodaxWithFactory();
    const seen: string[] = [];
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
      functionName: string;
      args?: readonly unknown[];
    }) => {
      seen.push(call.functionName);
      if (call.functionName === 'collateral') return POS_COLLATERAL;
      if (call.functionName === 'getReserveData') {
        expect(call.args).toEqual([POS_COLLATERAL]);
        return { aTokenAddress: POS_COLLATERAL };
      }
      return 1n;
    }) as never);

    const result = await configured.leverageYield.getPositionCollateralBalance(POSITION);
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['collateral', 'getReserveData', 'balanceOf']);
  });

  it('wraps a collateral-balance read failure as LOOKUP_FAILED', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('rpc down'));
    const result = await configured.leverageYield.getPositionCollateralBalance(POSITION, POS_COLLATERAL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });

  it("predictPosition defaults to the OWNER's next id, not a global counter", async () => {
    const configured = sodaxWithFactory();
    const seen: Record<string, readonly unknown[] | undefined> = {};
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
      functionName: string;
      args?: readonly unknown[];
    }) => {
      seen[call.functionName] = call.args;
      if (call.functionName === 'nextPositionIdFor') return 7n;
      return POSITION;
    }) as never);

    const result = await configured.leverageYield.predictPosition(POSITION_OWNER, POSITION_OWNER);
    expect(result.ok).toBe(true);
    // Per-owner, so another user creating a position cannot shift the address a funder predicted.
    expect(seen.nextPositionIdFor).toEqual([POSITION_OWNER]);
    expect(seen.predictPosition).toEqual([POSITION_OWNER, POSITION_OWNER, 7n]);
  });
});

describe('LeverageYieldService — position transaction builders', () => {
  it('leverage builders target the position itself', () => {
    const configured = sodaxWithFactory();
    const add = configured.leverageYield.buildAddLeverage({
      from: POSITION_OWNER,
      position: POSITION,
      borrowAmount: 1_000n,
      minCollateralOut: 1n,
    });
    const dec = configured.leverageYield.buildDecreaseLeverage({
      from: POSITION_OWNER,
      position: POSITION,
      collateralIn: 500n,
      minDebtOut: 1n,
    });
    expect(add.to).toBe(POSITION);
    expect(dec.to).toBe(POSITION);
    // Distinct selectors — guards against wiring both builders to the same function.
    expect(add.data.slice(0, 10)).not.toBe(dec.data.slice(0, 10));
  });

  it('withdraw and cancel encode against the position', () => {
    const configured = sodaxWithFactory();
    const withdraw = configured.leverageYield.buildPositionWithdraw({
      from: POSITION_OWNER,
      position: POSITION,
      amount: 1n,
      to: POSITION_OWNER,
    });
    const cancel = configured.leverageYield.buildCancelPositionOperation({
      from: POSITION_OWNER,
      position: POSITION,
    });
    expect(withdraw.to).toBe(POSITION);
    expect(cancel.to).toBe(POSITION);
    expect(cancel.data.length).toBe(10); // no args
  });
});

describe('LeverageYieldService — combined create + leverage', () => {
  it('buildCreatePositionAndLeverage targets the factory and is distinct from the debt-side open', () => {
    const configured = sodaxWithFactory();
    const base = {
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 0,
      // Hub origin: a refund is a plain transfer, so no unwrap asset is needed.
      origin: { chainKey: 'sonic', address: POSITION_OWNER },
    } as const;

    const combined = configured.leverageYield.buildCreatePositionAndLeverage({
      ...base,
      initialAssets: 10n ** 18n,
      borrowAmount: 1_000n,
      minCollateralOut: 1n,
    });
    const debtSide = configured.leverageYield.buildCreatePositionFromDebtToken({
      ...base,
      contribution: 10n ** 18n,
      totalInput: 2n * 10n ** 18n,
      minCollateralOut: 1n,
    });

    expect(combined.ok).toBe(true);
    expect(debtSide.ok).toBe(true);
    if (!combined.ok || !debtSide.ok) return;
    expect(combined.value.to).toBe(POSITION_FACTORY);
    expect(combined.value.value).toBe(0n);
    // Distinct selectors — the two opens pull different tokens, so crossing them would take the
    // wrong asset from the caller.
    expect(combined.value.data.slice(0, 10)).not.toBe(debtSide.value.data.slice(0, 10));
  });

  it('fails closed on a blanked-out factory override', () => {
    const result = sodaxWithoutFactory().leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 0,
      origin: { chainKey: 'sonic', address: POSITION_OWNER },
      initialAssets: 1n,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(false);
  });
});

// ─── Positions from any chain: payload shape + transport ───────────────────────────────
//
// The payload is what the hub wallet executes, so these assert the sequence it encodes rather
// than just that a call was made: getting the wrap or the approval wrong produces a batch that
// looks fine and reverts on the hub, after the user has already paid for the deposit.

describe('LeverageYieldService — opening a position from any chain', () => {
  /** The address a position will be created at — what funding is transferred to. */
  const PREDICTED = '0x00000000000000000000000000000000000000ff' as Address;

  /** Stubs the two factory reads the data builders make to resolve the predicted address. */
  function stubPrediction(sodaxInstance: Sodax): void {
    vi.spyOn(sodaxInstance.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
      functionName: string;
    }) => {
      if (call.functionName === 'nextPositionIdFor') return 0n;
      if (call.functionName === 'predictPosition') return PREDICTED;
      throw new Error(`unexpected read: ${call.functionName}`);
    }) as never);
  }

  /** Decodes an `encodeContractCalls` payload back into the batch it represents. */
  function decodeCalls(payload: Hex): { address: Address; value: bigint; data: Hex }[] {
    const [calls] = decodeAbiParameters(
      [
        {
          name: 'calls',
          type: 'tuple[]',
          components: [
            { name: 'address', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
          ],
        },
      ],
      payload,
    );
    return calls as { address: Address; value: bigint; data: Hex }[];
  }

  it('encodes wrap → transfer to the predicted position → create, and never approves the factory', async () => {
    const configured = sodaxWithFactory();
    stubPrediction(configured);
    const result = await configured.leverageYield.buildOpenPositionData({
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      token: SPOKE_TOKEN,
      amount: 10n ** 18n,
      owner: HUB_WALLET,
      borrowToken: POS_BORROW_TOKEN,
      borrowAmount: 5n * 10n ** 17n,
      minCollateralOut: 4n * 10n ** 17n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const calls = decodeCalls(result.value);
    // weETH is not itself a soda vault token, so it is wrapped: approve the vault, deposit into it,
    // transfer the shares to the address the position will exist at, then create.
    expect(calls).toHaveLength(4);
    expect(calls[3]?.address).toBe(POSITION_FACTORY);
    // The funding leg targets the predicted position and carries a plain ERC-20 transfer selector.
    expect(calls[2]?.address).toBe(SODA_ASSET);
    expect(calls[2]?.data.slice(0, 10)).toBe('0xa9059cbb'); // transfer(address,uint256)
    expect(calls[2]?.data.toLowerCase()).toContain(PREDICTED.slice(2).toLowerCase());
    // No approve(...) to the factory anywhere in the batch — it holds no allowance and pulls nothing.
    expect(
      calls.some(
        c =>
          c.data.slice(0, 10) === '0x095ea7b3' &&
          c.data.toLowerCase().includes(POSITION_FACTORY.slice(2).toLowerCase()),
      ),
    ).toBe(false);
    expect(calls.every(c => c.value === 0n)).toBe(true);
  });

  it('fails closed on a token with no hub asset, rather than encoding a batch that reverts on the hub', async () => {
    const configured = sodaxWithFactory();
    const result = await configured.leverageYield.buildOpenPositionData({
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      token: '0x000000000000000000000000000000000000dEaD',
      amount: 1n,
      owner: HUB_WALLET,
      borrowToken: POS_BORROW_TOKEN,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });

  it('records the funding chain and address as the position origin, so a failed intent refunds to the user', async () => {
    const configured = sodaxWithFactory();
    stubPrediction(configured);
    const result = await configured.leverageYield.buildOpenPositionData({
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      token: SPOKE_TOKEN,
      amount: 10n ** 18n,
      owner: HUB_WALLET,
      borrowToken: POS_BORROW_TOKEN,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const create = decodeCalls(result.value).at(-1);
    // The SODAX relay id for Arbitrum (23), not the EVM chain id — a refund keyed on 42161 goes nowhere.
    const relayId = getIntentRelayChainId(ARBITRUM);
    expect(create?.data.toLowerCase()).toContain(relayId?.toString(16).padStart(64, '0'));
    // …and the user's own address, not the hub wallet's and not the position's.
    expect(create?.data.toLowerCase()).toContain(SAMPLE_USER.slice(2).toLowerCase());
  });

  it('the debt-side open makes the deposited reserve the borrow token', async () => {
    const configured = sodaxWithFactory();
    stubPrediction(configured);
    const result = await configured.leverageYield.buildOpenPositionFromDebtTokenData({
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      token: SPOKE_TOKEN,
      amount: 10n ** 18n,
      owner: HUB_WALLET,
      collateral: POS_COLLATERAL,
      totalInput: 2n * 10n ** 18n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const create = decodeCalls(result.value).at(-1);
    expect(create?.address).toBe(POSITION_FACTORY);
    // The collateral the caller asked for is in the config, and the deposited token's own reserve
    // (sodaWEETH) is the borrow side — crossing these two would invert the position.
    expect(create?.data.toLowerCase()).toContain(POS_COLLATERAL.slice(2).toLowerCase());
    expect(create?.data.toLowerCase()).toContain(SODA_ASSET.slice(2).toLowerCase());
  });

  it('deposits to the hub wallet and waits for the relayed hub transaction', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(configured.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    stubPrediction(configured);
    vi.spyOn(configured.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xhubTx' } });

    const result = await configured.leverageYield.openPosition({
      params: {
        srcChainKey: ARBITRUM,
        srcAddress: SAMPLE_USER,
        token: SPOKE_TOKEN,
        amount: 10n ** 18n,
        borrowToken: POS_BORROW_TOKEN,
        borrowAmount: 1n,
        minCollateralOut: 1n,
      },
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both hashes matter: the spoke one is what the user sees, the hub one is where the intent
    // actually exists and so is what notifySolver has to be told about.
    expect(result.value).toEqual({ srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xhubTx' });
    const deposit = vi.mocked(configured.spoke.deposit).mock.calls[0]?.[0];
    // Funds land in the hub wallet, which is what the batch then spends.
    expect(deposit?.to).toBe(HUB_WALLET);
    expect(deposit?.amount).toBe(10n ** 18n);
  });

  it('on the hub there is nothing to relay, so both hashes are the one transaction', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(configured.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    stubPrediction(configured);
    vi.spyOn(configured.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xsonicTx' });
    mocks.relayTxAndWaitPacket.mockClear();

    const result = await configured.leverageYield.openPosition({
      params: {
        srcChainKey: SONIC,
        srcAddress: SAMPLE_USER,
        token: SODA_ASSET,
        amount: 10n ** 18n,
        borrowToken: POS_BORROW_TOKEN,
        borrowAmount: 1n,
        minCollateralOut: 1n,
      },
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ srcChainTxHash: '0xsonicTx', dstChainTxHash: '0xsonicTx' });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('rejects a zero amount before asking the user to sign anything', async () => {
    const configured = sodaxWithFactory();
    const deposit = vi.spyOn(configured.spoke, 'deposit');

    const result = await configured.leverageYield.openPosition({
      params: {
        srcChainKey: ARBITRUM,
        srcAddress: SAMPLE_USER,
        token: SPOKE_TOKEN,
        amount: 0n,
        borrowToken: POS_BORROW_TOKEN,
        borrowAmount: 1n,
        minCollateralOut: 1n,
      },
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(deposit).not.toHaveBeenCalled();
  });
});

describe('LeverageYieldService.operatePosition', () => {
  it('relays the position calls as a hub-wallet message, with no deposit', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(configured.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    vi.spyOn(configured.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    const deposit = vi.spyOn(configured.spoke, 'deposit');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xhubTx' } });

    const add = configured.leverageYield.buildAddLeverage({
      from: HUB_WALLET,
      position: POSITION,
      borrowAmount: 10n,
      minCollateralOut: 9n,
    });
    const result = await configured.leverageYield.operatePosition({
      params: { srcChainKey: ARBITRUM, srcAddress: SAMPLE_USER, calls: [add] },
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xhubTx' });
    expect(deposit).not.toHaveBeenCalled();
    const message = vi.mocked(configured.spoke.sendMessage).mock.calls[0]?.[0];
    // Addressed to the hub wallet, because that is what the position's onlyOwner checks.
    expect(message?.dstAddress).toBe(HUB_WALLET);
    expect(message?.payload).toBe(configured.leverageYield.encodePositionCalls([add]));
  });

  it('rejects an empty batch', async () => {
    const configured = sodaxWithFactory();
    const result = await configured.leverageYield.operatePosition({
      params: { srcChainKey: ARBITRUM, srcAddress: SAMPLE_USER, calls: [] },
      walletProvider: mockEvmProvider,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('maps a relay timeout rather than reporting the operation as done', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(configured.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    vi.spyOn(configured.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({
      ok: false,
      error: { code: 'TIMEOUT', data: { payload: {} } },
    });

    const result = await configured.leverageYield.operatePosition({
      params: {
        srcChainKey: ARBITRUM,
        srcAddress: SAMPLE_USER,
        calls: [configured.leverageYield.buildSettlePosition({ from: HUB_WALLET, position: POSITION })],
      },
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
  });
});
