/**
 * Tests for EvmSpokeService — handles all EVM spoke chains (Ethereum, Arbitrum, Base, BSC,
 * Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia). Sonic is the hub and is
 * covered by SonicSpokeService.test.ts.
 *
 * Issue #109 — enable tests for all spoke services. Coverage is structured around multi-chain
 * parametrisation:
 *
 *   1. **Cache mechanism** (constructor, constructPublicClient, getPublicClient) — tests the
 *      publicClients map's lazy/cached behaviour. Single-chain (ARB) because the mechanism is
 *      chain-independent; multi-chain isolation is folded into a dedicated getPublicClient test.
 *
 *   2. **Per-chain method coverage** — every config-consuming public method runs through
 *      `describe.each(TEST_CHAINS)` against all 11 EVM spokes. Catches per-chain regressions:
 *      hardcoded addresses, wrong-chain config lookups, cache returning the wrong client.
 *
 *   3. **Chain-independent branches** — error handling, parameter defaults, relayId derivation,
 *      and viem-response-mapping branches. Run on ARB only because the code path doesn't depend
 *      on the chain (a regression there would surface on every chain identically, so 11×
 *      parametrisation is redundant).
 *
 *   4. **Cross-chain independence** — proves chains don't bleed into each other: distinct cached
 *      clients per chain, per-call `getChainConfig` lookup.
 *
 * Mocking: only `Erc20Service.isAllowanceValid` is mocked at its source path (wrapped by
 * `isAllowanceValid`). viem's `createPublicClient` runs against the real impl — transport
 * construction is lazy, so no network calls fire until a method is invoked (always spied per-test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  getIntentRelayChainId,
  spokeChainConfig,
  type Address,
  type EvmSpokeOnlyChainKey,
  type Hex,
  type IEvmWalletProvider,
} from '@sodax/types';
import { encodeFunctionData } from 'viem';
import { connectionAbi, erc20Abi, spokeAssetManagerAbi } from '../../abis/index.js';

// --- hoisted mocks --------------------------------------------------------

const mocks = vi.hoisted(() => ({
  erc20IsAllowanceValid: vi.fn(),
}));

vi.mock('../erc-20/Erc20Service.js', async () => {
  const actual = await vi.importActual<object>('../erc-20/Erc20Service.js');
  return {
    ...actual,
    Erc20Service: {
      isAllowanceValid: mocks.erc20IsAllowanceValid,
    },
  };
});

import { Sodax } from '../../entities/Sodax.js';
import { EvmSpokeService } from './EvmSpokeService.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const evmSpoke = sodax.spoke.evm;

// ARB is the canonical sample chain for chain-independent tests (cache mechanism, error branches,
// parameter defaults). BASE is used only inside the getPublicClient multi-chain-isolation test.
const ARB = ChainKeys.ARBITRUM_MAINNET;
const BASE = ChainKeys.BASE_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET; // sendMessage destination (hub chain)

const arbConfig = spokeChainConfig[ARB];
const ARB_ASSET_MANAGER = arbConfig.addresses.assetManager as Address;
const ARB_CONNECTION = arbConfig.addresses.connection as Address;
const ARB_NATIVE = arbConfig.nativeToken as Address;
const ARB_RPC = arbConfig.rpcUrl;
// A real ERC-20 deployed on Arbitrum (sourced from chain config). Grounds chain-independent
// branch tests in actual on-chain data.
const ARB_TOKEN: Address = arbConfig.bnUSD as Address;

// Per-user / per-flow inputs — these represent test users and call destinations, not
// infrastructure, so they have no config source.
const SRC_ADDR: Address = '0x1111111111111111111111111111111111111111';
const HUB_WALLET: Address = '0x2222222222222222222222222222222222222222';
const DST_ADDR: Address = '0x3333333333333333333333333333333333333333';

const TX_HASH = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;

const mockEvmProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;

// Every EVM spoke chain. Sonic is intentionally NOT here — it's the hub chain and is covered
// by SonicSpokeService.test.ts. The `satisfies readonly EvmSpokeOnlyChainKey[]` constraint
// enforces the exclusion at compile time: adding SONIC_MAINNET (or any non-EVM-spoke key) fails
// typecheck.
const TEST_CHAINS = [
  ChainKeys.ETHEREUM_MAINNET,
  ChainKeys.ARBITRUM_MAINNET,
  ChainKeys.BASE_MAINNET,
  ChainKeys.OPTIMISM_MAINNET,
  ChainKeys.BSC_MAINNET,
  ChainKeys.POLYGON_MAINNET,
  ChainKeys.AVALANCHE_MAINNET,
  ChainKeys.HYPEREVM_MAINNET,
  ChainKeys.LIGHTLINK_MAINNET,
  ChainKeys.REDBELLY_MAINNET,
  ChainKeys.KAIA_MAINNET,
] as const satisfies readonly EvmSpokeOnlyChainKey[];

// Warm the publicClients cache for ARB so chain-independent test spies have a stable client
// reference. `vi.restoreAllMocks` in afterEach tears down spies between tests; the cached
// PublicClient persists for the file lifetime.
const arbClient = evmSpoke.getPublicClient(ARB);

beforeEach(() => {
  vi.clearAllMocks();
  (mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 1. Constructor + cache mechanism (chain-independent)
// =========================================================================

describe('EvmSpokeService — constructor', () => {
  it('exposes the spoke instance on sodax.spoke.evm with the expected method surface', () => {
    // Smoke: the constructor only assigns `config` and initialises an empty cache map. Pin the
    // method surface so a renamed method surfaces here instead of deep in a feature service test.
    expect(evmSpoke).toBeInstanceOf(EvmSpokeService);
    expect(typeof evmSpoke.getPublicClient).toBe('function');
    expect(typeof evmSpoke.constructPublicClient).toBe('function');
    expect(typeof evmSpoke.estimateGas).toBe('function');
    expect(typeof evmSpoke.isAllowanceValid).toBe('function');
    expect(typeof evmSpoke.deposit).toBe('function');
    expect(typeof evmSpoke.getDeposit).toBe('function');
    expect(typeof evmSpoke.sendMessage).toBe('function');
    expect(typeof evmSpoke.waitForTransactionReceipt).toBe('function');
  });
});

describe('EvmSpokeService.constructPublicClient', () => {
  it('returns a viem PublicClient with the methods the rest of the class consumes', () => {
    const fresh = new EvmSpokeService(sodax.config);
    const client = fresh.constructPublicClient({ chainId: ARB, rpcUrl: ARB_RPC });

    // We can't introspect the transport URL directly (viem buries it). The contract we depend
    // on is the method surface — anything missing breaks downstream methods.
    expect(typeof client.estimateGas).toBe('function');
    expect(typeof client.readContract).toBe('function');
    expect(typeof client.waitForTransactionReceipt).toBe('function');
  });

  it('stores the client in the cache so a subsequent getPublicClient returns the same instance', () => {
    const fresh = new EvmSpokeService(sodax.config);
    const created = fresh.constructPublicClient({ chainId: ARB, rpcUrl: ARB_RPC });
    expect(fresh.getPublicClient(ARB)).toBe(created);
  });

  it('falls back to the viem chain default RPC when rpcUrl is omitted', () => {
    // The branch under test: `transport: http(rpcUrl ?? chain.rpcUrls.default.http[0])`.
    // Smoke-only — viem's default-RPC fallback can't be observed from outside.
    const fresh = new EvmSpokeService(sodax.config);
    expect(() => fresh.constructPublicClient({ chainId: ARB })).not.toThrow();
  });
});

describe('EvmSpokeService.getPublicClient', () => {
  it('returns the cached client on the second call (no double-construction)', () => {
    const fresh = new EvmSpokeService(sodax.config);
    const first = fresh.getPublicClient(ARB);
    const constructSpy = vi.spyOn(fresh, 'constructPublicClient');

    const second = fresh.getPublicClient(ARB);
    expect(second).toBe(first);
    // Cache-hit branch must short-circuit before constructing again — otherwise we'd open new
    // transports on every call.
    expect(constructSpy).not.toHaveBeenCalled();
  });

  it('lazily constructs a client on the first call for a chain', () => {
    const fresh = new EvmSpokeService(sodax.config);
    const constructSpy = vi.spyOn(fresh, 'constructPublicClient');
    fresh.getPublicClient(ARB);
    expect(constructSpy).toHaveBeenCalledTimes(1);
    expect(constructSpy).toHaveBeenCalledWith({ chainId: ARB, rpcUrl: ARB_RPC });
  });

  it('maintains independent cached clients for distinct chains', () => {
    const fresh = new EvmSpokeService(sodax.config);
    const arb = fresh.getPublicClient(ARB);
    const base = fresh.getPublicClient(BASE);
    expect(arb).not.toBe(base);
    expect(fresh.getPublicClient(ARB)).toBe(arb);
    expect(fresh.getPublicClient(BASE)).toBe(base);
  });

  it('reads the per-chain rpcUrl from ConfigService when constructing', () => {
    const fresh = new EvmSpokeService(sodax.config);
    const constructSpy = vi.spyOn(fresh, 'constructPublicClient');
    fresh.getPublicClient(ARB);
    // Source of the URL is `config.getChainConfig(chainId).rpcUrl` — catches a regression that
    // swaps the source.
    expect(constructSpy).toHaveBeenCalledWith({ chainId: ARB, rpcUrl: ARB_RPC });
  });
});

// =========================================================================
// 2. Per-chain method coverage — every config-consuming method across all 11 EVM spokes
// =========================================================================
//
// EvmSpokeService is generic over the 11 non-hub EVM spoke chains. Restricting coverage to one
// chain misses regressions where:
//   - chain-specific addresses are hardcoded inside the SUT (only matter where addresses diverge),
//   - `getChainConfig` always reads ARB regardless of `srcChainKey`,
//   - the publicClients cache returns the wrong chain's client,
//   - `getEvmViemChain()` has a switch hole for one chain.
// Every method whose output depends on chain config (assetManager, connection, nativeToken) or
// on per-chain client routing is parametrised. Chain-independent error / mapping branches sit
// in section 3 to avoid redundant 11× runs of identical logic.
//
// Address diversity (drawn from chains.ts):
//   assetManager: 5 distinct values across 11 chains
//   connection:   5 distinct values across 11 chains
//   bnUSD:       11 distinct values across 11 chains
// Hardcode regressions surface on any chain whose value diverges from the hardcoded sample.

describe.each(TEST_CHAINS)('EvmSpokeService — %s', chainKey => {
  const chainConfig = spokeChainConfig[chainKey];
  const ASSET_MANAGER = chainConfig.addresses.assetManager as Address;
  const CONNECTION = chainConfig.addresses.connection as Address;
  const NATIVE = chainConfig.nativeToken as Address;
  const CHAIN_TOKEN = chainConfig.bnUSD as Address;
  // Cached PublicClient for this chain. Per-test spies are restored by afterEach; the cached
  // client itself persists for the file lifetime.
  const client = evmSpoke.getPublicClient(chainKey);

  describe('estimateGas', () => {
    it("delegates to this chain's cached publicClient.estimateGas with unpacked tx fields", async () => {
      const spy = vi.spyOn(client, 'estimateGas').mockResolvedValueOnce(50_000n);

      const result = await evmSpoke.estimateGas({
        chainKey,
        tx: { from: SRC_ADDR, to: HUB_WALLET, value: 1n, data: '0xcafe' as Hex },
      });

      expect(result).toBe(50_000n);
      // viem expects `account` (not `from`); the service renames the field. A regression that
      // passes `from` directly would silently produce wrong estimates.
      expect(spy).toHaveBeenCalledWith({
        account: SRC_ADDR,
        to: HUB_WALLET,
        value: 1n,
        data: '0xcafe',
      });
    });
  });

  describe('isAllowanceValid', () => {
    it("forwards this chain's nativeToken and cached publicClient to Erc20Service", async () => {
      mocks.erc20IsAllowanceValid.mockResolvedValueOnce({ ok: true, value: true });

      const result = await evmSpoke.isAllowanceValid({
        chainKey,
        token: CHAIN_TOKEN,
        owner: SRC_ADDR,
        spender: ASSET_MANAGER,
        amount: 1_000n,
      });

      expect(result).toEqual({ ok: true, value: true });
      // Erc20Service receives the per-chain cached client + per-chain nativeToken — both sourced
      // from config rather than hardcoded. A regression that always used ARB's client (or the
      // zero-address as nativeToken) surfaces on every chain except ARB.
      expect(mocks.erc20IsAllowanceValid).toHaveBeenCalledWith({
        chainKey,
        token: CHAIN_TOKEN,
        owner: SRC_ADDR,
        spender: ASSET_MANAGER,
        amount: 1_000n,
        publicClient: client,
        nativeToken: NATIVE,
      });
    });
  });

  describe('getDeposit', () => {
    it("reads balanceOf on this chain's cached client with this chain's assetManager as holder", async () => {
      const spy = vi.spyOn(client, 'readContract').mockResolvedValueOnce(7_500n);

      const result = await evmSpoke.getDeposit({
        srcChainKey: chainKey,
        srcAddress: SRC_ADDR,
        token: CHAIN_TOKEN,
      });

      expect(result).toBe(7_500n);
      // Holder is the per-chain spoke asset manager (NOT the token, NOT srcAddress). Contrasts
      // with SonicSpokeService.getDeposit which has a suspected v1 regression passing the token.
      expect(spy).toHaveBeenCalledWith({
        address: CHAIN_TOKEN,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ASSET_MANAGER],
      });
    });
  });

  describe('deposit', () => {
    const expectedCalldata = (token: Address, amount: bigint, data: Hex = '0x'): Hex =>
      encodeFunctionData({
        abi: spokeAssetManagerAbi,
        functionName: 'transfer',
        args: [token, HUB_WALLET, amount, data],
      });

    it("ERC20 raw=true → rawTx targets this chain's assetManager with value=0n", async () => {
      const result = await evmSpoke.deposit({
        srcAddress: SRC_ADDR,
        srcChainKey: chainKey,
        to: HUB_WALLET,
        token: CHAIN_TOKEN,
        amount: 1_000n,
        data: '0x' as Hex,
        raw: true,
      });

      expect(result).toEqual({
        from: SRC_ADDR,
        to: ASSET_MANAGER,
        value: 0n,
        data: expectedCalldata(CHAIN_TOKEN, 1_000n),
      });
    });

    it("ERC20 raw=false → walletProvider.sendTransaction receives this chain's rawTx", async () => {
      (mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

      const result = await evmSpoke.deposit({
        srcAddress: SRC_ADDR,
        srcChainKey: chainKey,
        to: HUB_WALLET,
        token: CHAIN_TOKEN,
        amount: 1_000n,
        data: '0x' as Hex,
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result).toBe(TX_HASH);
      expect(mockEvmProvider.sendTransaction).toHaveBeenCalledWith({
        from: SRC_ADDR,
        to: ASSET_MANAGER,
        value: 0n,
        data: expectedCalldata(CHAIN_TOKEN, 1_000n),
      });
    });

    it("native raw=true → value=amount when token matches this chain's nativeToken", async () => {
      const result = await evmSpoke.deposit({
        srcAddress: SRC_ADDR,
        srcChainKey: chainKey,
        to: HUB_WALLET,
        token: NATIVE,
        amount: 1_000n,
        data: '0x' as Hex,
        raw: true,
      });

      expect(result).toEqual({
        from: SRC_ADDR,
        to: ASSET_MANAGER,
        value: 1_000n,
        data: expectedCalldata(NATIVE, 1_000n),
      });
    });

    it("native raw=false → walletProvider.sendTransaction receives this chain's rawTx", async () => {
      (mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);
      const result = await evmSpoke.deposit({
        srcAddress: SRC_ADDR,
        srcChainKey: chainKey,
        to: HUB_WALLET,
        token: NATIVE,
        amount: 1_000n,
        data: '0x' as Hex,
        raw: false,
        walletProvider: mockEvmProvider,
      });
      expect(result).toBe(TX_HASH);
      expect(mockEvmProvider.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ to: ASSET_MANAGER, value: 1_000n }),
      );
    });
  });

  describe('sendMessage', () => {
    const expectedCalldata = (dstAddr: Address, payload: Hex) =>
      encodeFunctionData({
        abi: connectionAbi,
        functionName: 'sendMessage',
        args: [getIntentRelayChainId(SONIC), dstAddr, payload],
      });

    it("raw=true → rawTx targets this chain's connection with relay-id-encoded calldata", async () => {
      // BSC, HyperEVM, Lightlink, and Redbelly have connection addresses distinct from the
      // ARB/BASE/OPT/POL/AVAX/ETH/KAIA group. Their iterations are the actual catchers for a
      // "connection address hardcoded from one sample chain" regression.
      const result = await evmSpoke.sendMessage({
        srcAddress: SRC_ADDR,
        srcChainKey: chainKey,
        dstChainKey: SONIC,
        dstAddress: DST_ADDR,
        payload: '0xpayload' as Hex,
        raw: true,
      });

      expect(result).toEqual({
        from: SRC_ADDR,
        to: CONNECTION,
        // sendMessage always sets value to 0n — pure message dispatch, no token transfer.
        value: 0n,
        data: expectedCalldata(DST_ADDR, '0xpayload' as Hex),
      });
    });

    it("raw=false → walletProvider.sendTransaction receives this chain's connection rawTx", async () => {
      (mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

      const result = await evmSpoke.sendMessage({
        srcAddress: SRC_ADDR,
        srcChainKey: chainKey,
        dstChainKey: SONIC,
        dstAddress: DST_ADDR,
        payload: '0xpayload' as Hex,
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result).toBe(TX_HASH);
      expect(mockEvmProvider.sendTransaction).toHaveBeenCalledWith({
        from: SRC_ADDR,
        to: CONNECTION,
        value: 0n,
        data: expectedCalldata(DST_ADDR, '0xpayload' as Hex),
      });
    });
  });

  describe('waitForTransactionReceipt', () => {
    it("reads the receipt from this chain's cached client and maps it correctly", async () => {
      // Spying on this chain's client proves the chainKey → cached client routing works. A
      // regression that always used ARB's client surfaces on every non-ARB chain.
      const baseReceipt = {
        status: 'success' as const,
        transactionIndex: 0,
        blockNumber: 1n,
        cumulativeGasUsed: 21_000n,
        gasUsed: 21_000n,
        contractAddress: null,
        effectiveGasPrice: 1n,
        logs: [],
      };
      const spy = vi.spyOn(client, 'waitForTransactionReceipt').mockResolvedValueOnce(baseReceipt as never);

      const result = await evmSpoke.waitForTransactionReceipt({ chainKey, txHash: TX_HASH });

      expect(spy).toHaveBeenCalledWith({
        hash: TX_HASH,
        pollingInterval: undefined,
        timeout: undefined,
      });
      if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
      expect(result.value.receipt.blockNumber).toBe('1');
    });
  });
});

// =========================================================================
// 3. Chain-independent branches (run on ARB only — logic doesn't depend on chain)
// =========================================================================
//
// These tests exercise code paths whose behaviour is identical across all chains: error wrapping,
// parameter defaults, comparison logic (toLowerCase), viem-response field mapping. Running them
// 11× over TEST_CHAINS would be pure noise — a regression in any of these surfaces uniformly on
// every chain, so one chain (ARB) suffices to catch it.

describe('EvmSpokeService.estimateGas — bigint precision', () => {
  it('forwards the bigint return value verbatim (no precision loss)', async () => {
    const huge = 999_999_999_999_999_999n;
    vi.spyOn(arbClient, 'estimateGas').mockResolvedValueOnce(huge);
    const result = await evmSpoke.estimateGas({
      chainKey: ARB,
      tx: { from: SRC_ADDR, to: HUB_WALLET, value: 0n, data: '0x' as Hex },
    });
    expect(result).toBe(huge);
  });
});

describe('EvmSpokeService.isAllowanceValid — error branches', () => {
  const params = {
    chainKey: ARB,
    token: ARB_TOKEN,
    owner: SRC_ADDR,
    spender: ARB_ASSET_MANAGER,
    amount: 1_000n,
  };

  it('forwards a sub-Result failure as-is (Erc20Service returned ok:false)', async () => {
    const subError = new Error('allowance check failed');
    mocks.erc20IsAllowanceValid.mockResolvedValueOnce({ ok: false, error: subError });
    const result = await evmSpoke.isAllowanceValid(params);
    // The inner Result is re-emitted unchanged, no re-wrapping.
    expect(result).toEqual({ ok: false, error: subError });
  });

  it('catches thrown errors and wraps them in ok:false (raw error, no Error coercion)', async () => {
    // ⚠️ NOTE: the catch returns `error: e` with the raw thrown value. Contrast with
    // waitForTransactionReceipt which wraps non-Errors via `new Error(String(error))`. This is
    // an inconsistency in EvmSpokeService — pinned here so a unifying refactor surfaces here.
    const thrown = new Error('rpc unavailable');
    mocks.erc20IsAllowanceValid.mockRejectedValueOnce(thrown);
    const result = await evmSpoke.isAllowanceValid(params);
    expect(result).toEqual({ ok: false, error: thrown });
  });
});

describe('EvmSpokeService.deposit — chain-independent branches', () => {
  const expectedCalldata = (token: Address, amount: bigint, data: Hex = '0x'): Hex =>
    encodeFunctionData({
      abi: spokeAssetManagerAbi,
      functionName: 'transfer',
      args: [token, HUB_WALLET, amount, data],
    });

  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<typeof ARB, Raw>>,
  ): DepositParams<typeof ARB, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: ARB,
      to: HUB_WALLET,
      token: ARB_TOKEN,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockEvmProvider,
      ...overrides,
    }) as DepositParams<typeof ARB, Raw>;

  it('threads a non-default `data` blob through to the transfer call', async () => {
    const extraData = '0xfeedface' as Hex;
    const result = await evmSpoke.deposit(depositParams<true>({ data: extraData, raw: true }));
    expect(result.data).toBe(expectedCalldata(ARB_TOKEN, 1_000n, extraData));
  });

  it('case-insensitive native check — UPPERCASE token address still triggers value=amount', async () => {
    // Implementation: `token.toLowerCase() === chainConfig.nativeToken.toLowerCase()`. An
    // EIP-55-mixed-case or fully-uppercase form of the same address must still match. Dropping
    // the .toLowerCase() guard would silently send value=0 with a non-native calldata to the
    // asset manager (which would revert at the contract).
    const uppered = ARB_NATIVE.toUpperCase().replace('0X', '0x') as Address;
    const result = await evmSpoke.deposit(depositParams<true>({ token: uppered, raw: true }));
    expect(result.value).toBe(1_000n);
  });

  it("defaults data to '0x' when omitted", async () => {
    // Destructuring default: `data = '0x'`. Omitting the key entirely should still produce valid
    // transfer calldata rather than `data: undefined` (which would break encoding).
    const params = {
      srcAddress: SRC_ADDR,
      srcChainKey: ARB,
      to: HUB_WALLET,
      token: ARB_TOKEN,
      amount: 1_000n,
      raw: true,
    } as unknown as DepositParams<typeof ARB, true>;

    const result = await evmSpoke.deposit(params);
    expect(result.data).toBe(expectedCalldata(ARB_TOKEN, 1_000n, '0x'));
  });
});

describe('EvmSpokeService.sendMessage — relayId derivation', () => {
  it('derives the relayId from dstChainKey (the hub chain), not srcChainKey', async () => {
    // Defensive: a regression that mixed up dstChainKey/srcChainKey would still pass the rawTx
    // smoke test if both happened to round-trip through getIntentRelayChainId. Pin the hub
    // chain's id (146n per packages/types/src/chains/chains.ts) to catch that swap.
    const params: SendMessageParams<typeof ARB, true> = {
      srcAddress: SRC_ADDR,
      srcChainKey: ARB,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xpayload' as Hex,
      raw: true,
    };
    const result = await evmSpoke.sendMessage(params);
    expect(getIntentRelayChainId(SONIC)).toBe(146n);
    expect(result.data).toBe(
      encodeFunctionData({
        abi: connectionAbi,
        functionName: 'sendMessage',
        args: [146n, DST_ADDR, '0xpayload' as Hex],
      }),
    );
  });
});

describe('EvmSpokeService.waitForTransactionReceipt — branches & mapping', () => {
  // Minimal viem TransactionReceipt-ish shape. Cast through `as never` because viem's full
  // receipt type has ~20 fields none of which matter for the mapping branches under test.
  const baseReceipt = {
    status: 'success' as const,
    transactionIndex: 5,
    blockNumber: 1_000_000n,
    cumulativeGasUsed: 21_000n,
    gasUsed: 21_000n,
    contractAddress: null as Address | null,
    effectiveGasPrice: 7n,
    logs: [],
  };

  it('maps a successful receipt to status:success with stringified bigints', async () => {
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      ...baseReceipt,
      contractAddress: '0xabcabcabcabcabcabcabcabcabcabcabcabcabca' as Address,
    } as never);

    const result = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'success') throw new Error('expected success');
    // Every bigint field is `.toString()`-coerced — receipts cross the JSON boundary in some
    // callers, so bigints would throw. Pin the coercion for each field.
    expect(result.value.receipt.transactionIndex).toBe('5');
    expect(result.value.receipt.blockNumber).toBe('1000000');
    expect(result.value.receipt.cumulativeGasUsed).toBe('21000');
    expect(result.value.receipt.gasUsed).toBe('21000');
    expect(result.value.receipt.effectiveGasPrice).toBe('7');
    expect(result.value.receipt.contractAddress).toBe('0xabcabcabcabcabcabcabcabcabcabcabcabcabca');
  });

  it('coerces null contractAddress to null via the `?? null` fallback', async () => {
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      ...baseReceipt,
      contractAddress: null,
    } as never);

    const result = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'success') throw new Error('expected success');
    expect(result.value.receipt.contractAddress).toBeNull();
  });

  it('stringifies blockNumber / logIndex / transactionIndex on each log entry', async () => {
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      ...baseReceipt,
      logs: [
        {
          address: '0xlogaddrlogaddrlogaddrlogaddrlogaddr00' as Address,
          blockNumber: 999n,
          logIndex: 2,
          transactionIndex: 5,
          topics: [],
          data: '0x' as Hex,
        },
      ],
    } as never);

    const result = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(result.value.receipt.logs[0]).toMatchObject({
      blockNumber: '999',
      logIndex: '2',
      transactionIndex: '5',
    });
  });

  it('returns status:failure when receipt.status === "reverted"', async () => {
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      ...baseReceipt,
      status: 'reverted',
    } as never);

    const result = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error).toBeInstanceOf(Error);
    expect((result.value.error as Error).message).toBe('Transaction reverted');
  });

  it('returns status:timeout when the thrown error message contains "timed out"', async () => {
    const timeoutErr = new Error('Transaction not received: timed out after 30s');
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockRejectedValueOnce(timeoutErr);

    const result = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
    if (result.value.status !== 'timeout') return;
    expect(result.value.error).toBe(timeoutErr);
  });

  it('returns status:failure for non-timeout Error throws', async () => {
    const otherErr = new Error('connection refused');
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockRejectedValueOnce(otherErr);

    const result = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error).toBe(otherErr);
  });

  it('wraps non-Error throws into a new Error(String(thrown))', async () => {
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockRejectedValueOnce('boom');

    const result = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error).toBeInstanceOf(Error);
    expect((result.value.error as Error).message).toBe('boom');
  });

  it('forwards custom pollingIntervalMs / maxTimeoutMs to viem', async () => {
    const spy = vi.spyOn(arbClient, 'waitForTransactionReceipt').mockResolvedValueOnce(baseReceipt as never);

    await evmSpoke.waitForTransactionReceipt({
      chainKey: ARB,
      txHash: TX_HASH,
      pollingIntervalMs: 123,
      maxTimeoutMs: 4_567,
    });

    expect(spy).toHaveBeenCalledWith({ hash: TX_HASH, pollingInterval: 123, timeout: 4_567 });
  });

  it('passes undefined to viem when polling/timeout params are omitted (no SDK-side default)', async () => {
    // ⚠️ NOTE: unlike SonicSpokeService, EvmSpokeService does NOT fall back to
    // `chainConfig.pollingConfig` defaults — caller's undefined goes straight to viem (which
    // applies its own internals). Pinned as current behaviour; if alignment with Sonic is
    // desired, mirror the `?? chainConfig.pollingConfig.pollingIntervalMs` pattern.
    const spy = vi.spyOn(arbClient, 'waitForTransactionReceipt').mockResolvedValueOnce(baseReceipt as never);

    await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    const call = spy.mock.calls[0]?.[0];
    expect(call?.pollingInterval).toBeUndefined();
    expect(call?.timeout).toBeUndefined();
  });

  it('leaves effectiveGasPrice undefined when viem returns it as undefined (optional-chain branch)', async () => {
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      ...baseReceipt,
      effectiveGasPrice: undefined,
    } as never);

    const result = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(result.value.receipt.effectiveGasPrice).toBeUndefined();
  });
});

// =========================================================================
// 4. Cross-chain independence — cache isolation + per-call config lookup
// =========================================================================
//
// The describe.each above proves each method works *for* every chain in isolation. These tests
// prove different chains don't bleed into each other within a single Sodax instance: the
// publicClients map is keyed correctly, and `getChainConfig` is read per call (not snapshotted
// at construction).

describe('EvmSpokeService — cross-chain independence', () => {
  it('getPublicClient returns a distinct cached instance for every chain (all-pairs)', () => {
    // All-pairs comparison catches a map keyed wrong even if some entries happen to collide
    // (e.g. a regression that stored every chain under the same key would have 1 distinct
    // client across 11 keys — easily detected here).
    const clients = TEST_CHAINS.map(k => evmSpoke.getPublicClient(k));
    for (let i = 0; i < clients.length; i++) {
      for (let j = i + 1; j < clients.length; j++) {
        expect(clients[i]).not.toBe(clients[j]);
      }
    }
  });

  it('deposit on every chain reads getChainConfig with the matching srcChainKey', async () => {
    const spy = vi.spyOn(sodax.config, 'getChainConfig');

    for (const chainKey of TEST_CHAINS) {
      await evmSpoke.deposit({
        srcAddress: SRC_ADDR,
        srcChainKey: chainKey,
        to: HUB_WALLET,
        token: spokeChainConfig[chainKey].bnUSD as Address,
        amount: 1n,
        data: '0x' as Hex,
        raw: true,
      });
    }

    // Every chain key must appear in the spy's calls. A regression that snapshotted chainKey
    // at module-init (or hardcoded a specific chain) would show one key dominating the call
    // list and the other 10 missing.
    for (const chainKey of TEST_CHAINS) {
      expect(spy).toHaveBeenCalledWith(chainKey);
    }
  });
});
