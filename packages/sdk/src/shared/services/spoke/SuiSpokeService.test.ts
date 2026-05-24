/**
 * Tests for SuiSpokeService — the single Sui spoke chain.
 *
 * Pattern: mirrors EvmSpokeService.test.ts (issue #109) but collapsed to a single chain. Sui has
 * one chain (`ChainKeys.SUI_MAINNET`), so there is no `describe.each` parametrisation, no per-chain
 * client cache, and no cross-chain independence section. The single-chain shape is closer to
 * `SonicSpokeService.test.ts`: one Sodax instance backs every test; `sodax.spoke.sui.publicClient`
 * methods are spied per-test; `vi.restoreAllMocks` in `afterEach` tears them down.
 *
 * Real config data is used wherever possible — every Move type string, package id, module name,
 * polling interval, and timeout is sourced from `spokeChainConfig[SUI_MAINNET]` rather than fake
 * constants. That catches a class of regressions where a hardcoded value happens to match a test
 * fixture but diverges from production config (wrong package, wrong module name, etc.). Only user
 * identities (`SRC_ADDR`, `HUB_WALLET`, `DST_ADDR`) and per-test scratch data (digests, mock
 * balances) are fabricated.
 *
 * `@mysten/sui` is NOT module-mocked: real `Transaction`, `bcs`, and `SuiClient` constructors run.
 * `tx.build({ onlyTransactionKind: true })` is a local-only operation (no network). Only the four
 * `publicClient` network methods used by the SUT are spied per-test:
 *   - getCoins, getObject, devInspectTransactionBlock, waitForTransaction.
 *
 * The cached `assetManagerAddress` field persists for the file lifetime, so `beforeEach` resets it
 * to `undefined` to keep cache-hit/cache-miss tests independent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { toHex } from 'viem';
import {
  ChainKeys,
  getIntentRelayChainId,
  spokeChainConfig,
  type Address,
  type Hex,
  type ISuiWalletProvider,
  type SuiPaginatedCoins,
} from '@sodax/types';

import { Sodax } from '../../entities/Sodax.js';
import { SuiSpokeService } from './SuiSpokeService.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const suiSpoke = sodax.spoke.sui;

const SUI = ChainKeys.SUI_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET; // sendMessage destination (hub chain)

// REAL config — every consumer of these values in production reads from the same source.
const suiConfig = spokeChainConfig[SUI];
const SUI_NATIVE = suiConfig.nativeToken;
const SUI_BNUSD = suiConfig.bnUSD;
const SUI_CONNECTION = suiConfig.addresses.connection;
const SUI_ASSET_MGR = suiConfig.addresses.assetManager;
const SUI_ASSET_MGR_CONFIG_ID = suiConfig.addresses.assetManagerConfigId;
const SUI_POLLING_MS = suiConfig.pollingConfig.pollingIntervalMs;
const SUI_TIMEOUT_MS = suiConfig.pollingConfig.maxTimeoutMs;

// Derived from real config via the SUT's own parser — proves the splitAddress contract
// round-trips against config and gives us the exact `to` strings the SUT will produce.
const { packageId: SUI_ASSET_MGR_PKG, moduleId: SUI_ASSET_MGR_MOD } = suiSpoke.splitAddress(SUI_ASSET_MGR);
const {
  packageId: SUI_CONN_PKG,
  moduleId: SUI_CONN_MOD,
  stateId: SUI_CONN_STATE,
} = suiSpoke.splitAddress(SUI_CONNECTION);

// Per-user / per-flow scratch — these have no config source.
const SRC_ADDR = `0x${'11'.repeat(32)}` as Address; // valid 32-byte Sui address
const HUB_WALLET: Address = '0x2222222222222222222222222222222222222222';
const DST_ADDR: Address = '0x3333333333333333333333333333333333333333';
const TX_DIGEST = '7g6sQdY5RrZ4kRzBz7VLgY3qX2vN6Y4mT8L1J5K9A2Bx';

const mockSuiProvider = {
  chainType: 'SUI',
  signAndExecuteTxn: vi.fn(),
  getWalletAddress: vi.fn(),
  viewContract: vi.fn(),
  getCoins: vi.fn(),
} as unknown as ISuiWalletProvider;

// SuiPaginatedCoins helper — the on-wire shape returned by publicClient.getCoins.
const makeCoinsPage = (
  coins: Array<{ balance: string; coinObjectId: string }>,
  coinType: string = SUI_BNUSD,
): SuiPaginatedCoins =>
  ({
    data: coins.map(c => ({
      coinType,
      coinObjectId: c.coinObjectId,
      version: '1',
      digest: 'deadbeef',
      balance: c.balance,
      previousTransaction: 'deadbeef',
    })),
    hasNextPage: false,
    nextCursor: null,
  }) as unknown as SuiPaginatedCoins;

// Valid moveObject result from getObject — fields contain a real `latest_package_id`.
const makeGetObjectResult = (latestPackageId: unknown) =>
  ({
    data: {
      content: {
        dataType: 'moveObject',
        fields: { latest_package_id: latestPackageId },
      },
    },
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  // Cache lives on the shared instance for the file lifetime — reset so cache-hit / cache-miss
  // tests don't bleed into each other.
  suiSpoke.assetManagerAddress = undefined;
  (mockSuiProvider.signAndExecuteTxn as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 1. constructor
// =========================================================================

describe('SuiSpokeService — constructor', () => {
  it('exposes the spoke instance on sodax.spoke.sui with the expected method surface', () => {
    expect(suiSpoke).toBeInstanceOf(SuiSpokeService);
    expect(typeof suiSpoke.getCoins).toBe('function');
    expect(typeof suiSpoke.getCoin).toBe('function');
    expect(typeof suiSpoke.splitAddress).toBe('function');
    expect(typeof suiSpoke.getNativeCoin).toBe('function');
    expect(typeof suiSpoke.encodeSimulationParams).toBe('function');
    expect(typeof suiSpoke.getAssetManagerAddress).toBe('function');
    expect(typeof suiSpoke.viewContract).toBe('function');
    expect(typeof suiSpoke.deposit).toBe('function');
    expect(typeof suiSpoke.sendMessage).toBe('function');
    expect(typeof suiSpoke.estimateGas).toBe('function');
    expect(typeof suiSpoke.getDeposit).toBe('function');
    expect(typeof suiSpoke.fetchAssetManagerAddress).toBe('function');
    expect(typeof suiSpoke.fetchLatestAssetManagerPackageId).toBe('function');
    expect(typeof suiSpoke.waitForTransactionReceipt).toBe('function');
  });

  it('wires a SuiClient with the methods the rest of the class consumes', () => {
    // The transport URL is buried inside the @mysten/sui client; pin the method surface instead.
    expect(suiSpoke.publicClient).toBeDefined();
    expect(typeof suiSpoke.publicClient.getCoins).toBe('function');
    expect(typeof suiSpoke.publicClient.getObject).toBe('function');
    expect(typeof suiSpoke.publicClient.devInspectTransactionBlock).toBe('function');
    expect(typeof suiSpoke.publicClient.waitForTransaction).toBe('function');
  });

  it('starts with an empty asset-manager cache', () => {
    expect(suiSpoke.assetManagerAddress).toBeUndefined();
  });
});

// =========================================================================
// 2. getCoins — pass-through to publicClient.getCoins
// =========================================================================

describe('SuiSpokeService.getCoins', () => {
  it('forwards owner + coinType and the hardcoded limit:10 to publicClient.getCoins', async () => {
    const page = makeCoinsPage([{ balance: '1000', coinObjectId: '0xa' }]);
    const spy = vi.spyOn(suiSpoke.publicClient, 'getCoins').mockResolvedValueOnce(page);

    const result = await suiSpoke.getCoins(SRC_ADDR, SUI_BNUSD);

    expect(result).toBe(page);
    expect(spy).toHaveBeenCalledWith({ owner: SRC_ADDR, coinType: SUI_BNUSD, limit: 10 });
  });
});

// =========================================================================
// 3. getCoin — coin selection / merge / split branches
// =========================================================================

describe('SuiSpokeService.getCoin', () => {
  it('single coin with exact balance → tx.object (no merge, no split)', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([{ balance: '1000', coinObjectId: '0xa' }]),
    );
    const tx = new Transaction();
    const mergeSpy = vi.spyOn(tx, 'mergeCoins');
    const splitSpy = vi.spyOn(tx, 'splitCoins');
    const objectSpy = vi.spyOn(tx, 'object');

    await suiSpoke.getCoin(tx, SUI_BNUSD, 1_000n, SRC_ADDR);

    expect(mergeSpy).not.toHaveBeenCalled();
    expect(splitSpy).not.toHaveBeenCalled();
    expect(objectSpy).toHaveBeenCalledWith('0xa');
  });

  it('single coin with excess balance → tx.splitCoins for the exact amount', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([{ balance: '5000', coinObjectId: '0xa' }]),
    );
    const tx = new Transaction();
    const splitSpy = vi.spyOn(tx, 'splitCoins');

    await suiSpoke.getCoin(tx, SUI_BNUSD, 1_000n, SRC_ADDR);

    expect(splitSpy).toHaveBeenCalledWith('0xa', [1_000n]);
  });

  it('multiple coins summing above amount → mergeCoins then splitCoins', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([
        { balance: '500', coinObjectId: '0xa' },
        { balance: '700', coinObjectId: '0xb' },
      ]),
    );
    const tx = new Transaction();
    const mergeSpy = vi.spyOn(tx, 'mergeCoins');
    const splitSpy = vi.spyOn(tx, 'splitCoins');

    await suiSpoke.getCoin(tx, SUI_BNUSD, 1_000n, SRC_ADDR);

    // first object is the merge destination; remaining objects (slice(1)) are merged in
    expect(mergeSpy).toHaveBeenCalledWith('0xa', ['0xb']);
    expect(splitSpy).toHaveBeenCalledWith('0xa', [1_000n]);
  });

  it('multiple coins summing to exact amount → mergeCoins then tx.object (no split)', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([
        { balance: '500', coinObjectId: '0xa' },
        { balance: '500', coinObjectId: '0xb' },
      ]),
    );
    const tx = new Transaction();
    const mergeSpy = vi.spyOn(tx, 'mergeCoins');
    const splitSpy = vi.spyOn(tx, 'splitCoins');
    const objectSpy = vi.spyOn(tx, 'object');

    await suiSpoke.getCoin(tx, SUI_BNUSD, 1_000n, SRC_ADDR);

    expect(mergeSpy).toHaveBeenCalledWith('0xa', ['0xb']);
    expect(splitSpy).not.toHaveBeenCalled();
    expect(objectSpy).toHaveBeenCalledWith('0xa');
  });

  it('stops iterating coins once totalAmount >= amount (third coin not included)', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([
        { balance: '600', coinObjectId: '0xa' },
        { balance: '500', coinObjectId: '0xb' },
        { balance: '999', coinObjectId: '0xc' },
      ]),
    );
    const tx = new Transaction();
    const mergeSpy = vi.spyOn(tx, 'mergeCoins');

    await suiSpoke.getCoin(tx, SUI_BNUSD, 1_000n, SRC_ADDR);

    // Only 0xb merged in; 0xc never reached because totalAmount hit 1100 >= 1000 on coin #2.
    expect(mergeSpy).toHaveBeenCalledWith('0xa', ['0xb']);
  });

  it('throws when no coins exist for the address', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getCoins').mockResolvedValueOnce(makeCoinsPage([]));
    const tx = new Transaction();

    await expect(suiSpoke.getCoin(tx, SUI_BNUSD, 1_000n, SRC_ADDR)).rejects.toThrow(
      `[SuiIntentService.getCoin] Coin=${SUI_BNUSD} not found for address=${SRC_ADDR} and amount=1000`,
    );
  });
});

// =========================================================================
// 4. splitAddress — pure parsing, error branches
// =========================================================================

describe('SuiSpokeService.splitAddress', () => {
  it('parses a valid pkg::module::state into its three parts', () => {
    // Real config value — round-trips against suiConfig.addresses.connection.
    expect(suiSpoke.splitAddress(SUI_CONNECTION)).toEqual({
      packageId: SUI_CONN_PKG,
      moduleId: SUI_CONN_MOD,
      stateId: SUI_CONN_STATE,
    });
  });

  it('throws on fewer than 3 segments', () => {
    expect(() => suiSpoke.splitAddress('pkg::module')).toThrow('Invalid package address');
  });

  it('throws on more than 3 segments', () => {
    expect(() => suiSpoke.splitAddress('pkg::module::state::extra')).toThrow('Invalid package address');
  });

  it('throws when any of the 3 segments is empty (trailing ::)', () => {
    // length === 3 but parts[2] is '' — falls through to the inner throw.
    expect(() => suiSpoke.splitAddress('pkg::module::')).toThrow('Invalid package address');
  });

  it('throws when the leading segment is empty (leading ::)', () => {
    expect(() => suiSpoke.splitAddress('::module::state')).toThrow('Invalid package address');
  });
});

// =========================================================================
// 5. getNativeCoin — split-from-gas path + undefined branch
// =========================================================================

describe('SuiSpokeService.getNativeCoin', () => {
  it('splits a coin from tx.gas for the requested amount', async () => {
    const tx = new Transaction();
    const splitSpy = vi.spyOn(tx, 'splitCoins');

    const coin = await suiSpoke.getNativeCoin(tx, 5_000n);

    expect(splitSpy).toHaveBeenCalledTimes(1);
    // First arg is tx.gas (an opaque reference); second is the amount tuple.
    const [, amounts] = splitSpy.mock.calls[0] ?? [];
    expect(Array.isArray(amounts)).toBe(true);
    expect(coin).toBeDefined();
  });

  it('rejects when tx.splitCoins yields an undefined element (defensive branch)', async () => {
    const tx = new Transaction();
    // Force the only path the catch covers — splitCoins returning [undefined].
    vi.spyOn(tx, 'splitCoins').mockReturnValueOnce([undefined as never]);

    await expect(suiSpoke.getNativeCoin(tx, 5_000n)).rejects.toThrow('[SuiIntentService.getNativeCoin] coin undefined');
  });
});

// =========================================================================
// 6. encodeSimulationParams — UTF-8 (NOT BCS Address) encoding for Move strings
// =========================================================================

describe('SuiSpokeService.encodeSimulationParams', () => {
  it('returns UTF-8 hex encodings of the token and assetManager Move type strings', () => {
    // Anti-regression for the in-source comment: Move type strings ("0xPKG::module::ID") must NOT
    // go through BCS Address serialization (which expects 32-byte hex). UTF-8 is the contract.
    const { encodedToken, encodedSrcAddress } = suiSpoke.encodeSimulationParams(SUI_BNUSD, SUI_ASSET_MGR);

    const encoder = new TextEncoder();
    expect(encodedToken).toBe(toHex(encoder.encode(SUI_BNUSD)));
    expect(encodedSrcAddress).toBe(toHex(encoder.encode(SUI_ASSET_MGR)));
  });
});

// =========================================================================
// 8. getAssetManagerAddress — fetch-then-cache semantics
// =========================================================================

describe('SuiSpokeService.getAssetManagerAddress', () => {
  it('first call fetches via getObject and composes pkg::asset_manager::configId', async () => {
    // Use the REAL package id from config so the composed result round-trips against
    // suiConfig.addresses.assetManager.
    const getObjectSpy = vi
      .spyOn(suiSpoke.publicClient, 'getObject')
      .mockResolvedValueOnce(makeGetObjectResult(SUI_ASSET_MGR_PKG));

    const result = await suiSpoke.getAssetManagerAddress(SUI);

    expect(result).toBe(SUI_ASSET_MGR);
    expect(getObjectSpy).toHaveBeenCalledTimes(1);
    expect(getObjectSpy).toHaveBeenCalledWith({
      id: SUI_ASSET_MGR_CONFIG_ID,
      options: { showContent: true },
    });
  });

  it('second call returns the cached value without re-fetching', async () => {
    const getObjectSpy = vi
      .spyOn(suiSpoke.publicClient, 'getObject')
      .mockResolvedValueOnce(makeGetObjectResult(SUI_ASSET_MGR_PKG));

    const first = await suiSpoke.getAssetManagerAddress(SUI);
    const second = await suiSpoke.getAssetManagerAddress(SUI);

    expect(second).toBe(first);
    expect(getObjectSpy).toHaveBeenCalledTimes(1);
  });
});

// =========================================================================
// 9. fetchLatestAssetManagerPackageId — every throw branch
// =========================================================================

describe('SuiSpokeService.fetchLatestAssetManagerPackageId', () => {
  it('returns the latest_package_id from a valid moveObject', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getObject').mockResolvedValueOnce(makeGetObjectResult(SUI_ASSET_MGR_PKG));

    const result = await suiSpoke.fetchLatestAssetManagerPackageId(SUI);

    expect(result).toBe(SUI_ASSET_MGR_PKG);
  });

  it('throws when getObject returns an error', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getObject').mockResolvedValueOnce({
      error: { code: 'notExists', object_id: SUI_ASSET_MGR_CONFIG_ID },
    } as never);

    await expect(suiSpoke.fetchLatestAssetManagerPackageId(SUI)).rejects.toThrow(/Failed to fetch asset manager id/);
  });

  it('throws when data is missing', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getObject').mockResolvedValueOnce({} as never);

    await expect(suiSpoke.fetchLatestAssetManagerPackageId(SUI)).rejects.toThrow(
      'Asset manager id not found (no data)',
    );
  });

  it('throws when content.dataType is not "moveObject"', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getObject').mockResolvedValueOnce({
      data: { content: { dataType: 'package' } },
    } as never);

    await expect(suiSpoke.fetchLatestAssetManagerPackageId(SUI)).rejects.toThrow(
      'Asset manager id not found (not a move object)',
    );
  });

  it('throws when fields lack `latest_package_id`', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getObject').mockResolvedValueOnce({
      data: { content: { dataType: 'moveObject', fields: {} } },
    } as never);

    await expect(suiSpoke.fetchLatestAssetManagerPackageId(SUI)).rejects.toThrow(
      'Asset manager id not found (no latest package id)',
    );
  });

  it('throws when latest_package_id is not a string', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getObject').mockResolvedValueOnce(makeGetObjectResult(12345));

    await expect(suiSpoke.fetchLatestAssetManagerPackageId(SUI)).rejects.toThrow(
      'Asset manager id invalid (latest package id is not a string)',
    );
  });

  it('throws when latest_package_id is an empty string', async () => {
    vi.spyOn(suiSpoke.publicClient, 'getObject').mockResolvedValueOnce(makeGetObjectResult(''));

    await expect(suiSpoke.fetchLatestAssetManagerPackageId(SUI)).rejects.toThrow(
      'Asset manager id not found (no latest package id)',
    );
  });
});

// =========================================================================
// 10. viewContract — devInspect delegation
// =========================================================================

describe('SuiSpokeService.viewContract', () => {
  it('queues a moveCall and returns the first inspect result', async () => {
    const tx = new Transaction();
    const moveCallSpy = vi.spyOn(tx, 'moveCall');
    const fakeResult = { returnValues: [[[1, 2, 3], 'u64']] };
    const inspectSpy = vi
      .spyOn(suiSpoke.publicClient, 'devInspectTransactionBlock')
      .mockResolvedValueOnce({ results: [fakeResult] } as never);

    const out = await suiSpoke.viewContract(tx, 'pkg', 'mod', 'fn', [], ['u64'], SRC_ADDR);

    expect(out).toBe(fakeResult);
    expect(moveCallSpy).toHaveBeenCalledWith({
      target: 'pkg::mod::fn',
      arguments: [],
      typeArguments: ['u64'],
    });
    expect(inspectSpy).toHaveBeenCalledWith({ transactionBlock: tx, sender: SRC_ADDR });
  });

  it('defaults typeArgs to [] when omitted', async () => {
    const tx = new Transaction();
    const moveCallSpy = vi.spyOn(tx, 'moveCall');
    vi.spyOn(suiSpoke.publicClient, 'devInspectTransactionBlock').mockResolvedValueOnce({
      results: [{ returnValues: [] }],
    } as never);

    // Last arg `sender` is required; typeArgs (the 6th positional) defaults to [].
    await suiSpoke.viewContract(tx, 'pkg', 'mod', 'fn', [], undefined as never, SRC_ADDR);

    expect(moveCallSpy).toHaveBeenCalledWith(expect.objectContaining({ typeArguments: [] }));
  });

  it('throws with the stringified result when devInspect returns no results', async () => {
    const tx = new Transaction();
    const inspectResult = { results: undefined };
    vi.spyOn(suiSpoke.publicClient, 'devInspectTransactionBlock').mockResolvedValueOnce(inspectResult as never);

    await expect(suiSpoke.viewContract(tx, 'pkg', 'mod', 'fn', [], [], SRC_ADDR)).rejects.toThrow(
      /transaction didn't return any values/,
    );
  });

  it('throws when results is an empty array', async () => {
    const tx = new Transaction();
    vi.spyOn(suiSpoke.publicClient, 'devInspectTransactionBlock').mockResolvedValueOnce({ results: [] } as never);

    await expect(suiSpoke.viewContract(tx, 'pkg', 'mod', 'fn', [], [], SRC_ADDR)).rejects.toThrow(
      /transaction didn't return any values/,
    );
  });
});

// =========================================================================
// 11. deposit — native vs ERC20, raw vs walletProvider, default `data`
// =========================================================================

describe('SuiSpokeService.deposit', () => {
  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<typeof SUI, Raw>>,
  ): DepositParams<typeof SUI, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: SUI,
      to: HUB_WALLET,
      token: SUI_BNUSD,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockSuiProvider,
      ...overrides,
    }) as DepositParams<typeof SUI, Raw>;

  const expectedTransferTarget = `${SUI_ASSET_MGR_PKG}::${SUI_ASSET_MGR_MOD}::transfer`;

  it('native raw=true → returns rawTx targeting <assetManager>::transfer with value=amount', async () => {
    suiSpoke.assetManagerAddress = SUI_ASSET_MGR;

    const result = await suiSpoke.deposit(depositParams<true>({ token: SUI_NATIVE, raw: true }));

    expect(result.from).toBe(SRC_ADDR);
    expect(result.to).toBe(expectedTransferTarget);
    expect(result.value).toBe(1_000n);
    // `data` is base64 of the transaction-kind bytes. Pin the shape, not the exact value (the
    // serialization is not deterministic across @mysten/sui versions).
    expect(typeof result.data).toBe('string');
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('native raw=true does NOT call publicClient.getCoins (native path uses tx.gas)', async () => {
    suiSpoke.assetManagerAddress = SUI_ASSET_MGR;
    const getCoinsSpy = vi.spyOn(suiSpoke.publicClient, 'getCoins');

    await suiSpoke.deposit(depositParams<true>({ token: SUI_NATIVE, raw: true }));

    expect(getCoinsSpy).not.toHaveBeenCalled();
  });

  it('ERC20 raw=true → fetches user coins and returns rawTx with value=amount', async () => {
    suiSpoke.assetManagerAddress = SUI_ASSET_MGR;
    vi.spyOn(suiSpoke.publicClient, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([{ balance: '5000', coinObjectId: '0xa' }]),
    );

    const result = await suiSpoke.deposit(depositParams<true>({ token: SUI_BNUSD, raw: true }));

    expect(result.to).toBe(expectedTransferTarget);
    expect(result.from).toBe(SRC_ADDR);
    expect(result.value).toBe(1_000n);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('ERC20 raw=true reads coins via publicClient.getCoins with the deposited coinType', async () => {
    suiSpoke.assetManagerAddress = SUI_ASSET_MGR;
    const getCoinsSpy = vi
      .spyOn(suiSpoke.publicClient, 'getCoins')
      .mockResolvedValueOnce(makeCoinsPage([{ balance: '5000', coinObjectId: '0xa' }]));

    await suiSpoke.deposit(depositParams<true>({ token: SUI_BNUSD, raw: true }));

    expect(getCoinsSpy).toHaveBeenCalledWith({ owner: SRC_ADDR, coinType: SUI_BNUSD, limit: 10 });
  });

  it('raw=false → delegates to walletProvider.signAndExecuteTxn and returns its digest', async () => {
    suiSpoke.assetManagerAddress = SUI_ASSET_MGR;
    vi.spyOn(suiSpoke.publicClient, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([{ balance: '5000', coinObjectId: '0xa' }]),
    );
    (mockSuiProvider.signAndExecuteTxn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_DIGEST);

    const result = await suiSpoke.deposit(depositParams<false>({ raw: false, walletProvider: mockSuiProvider }));

    expect(result).toBe(TX_DIGEST);
    expect(mockSuiProvider.signAndExecuteTxn).toHaveBeenCalledTimes(1);
    expect(mockSuiProvider.signAndExecuteTxn).toHaveBeenCalledWith(expect.any(Transaction));
  });

  it("defaults data to '0x' when omitted from the deposit params", async () => {
    suiSpoke.assetManagerAddress = SUI_ASSET_MGR;
    // Drop `data` entirely; the destructuring `data = '0x'` default must kick in.
    const params = {
      srcAddress: SRC_ADDR,
      srcChainKey: SUI,
      to: HUB_WALLET,
      token: SUI_NATIVE,
      amount: 1_000n,
      raw: true,
    } as unknown as DepositParams<typeof SUI, true>;

    await expect(suiSpoke.deposit(params)).resolves.toMatchObject({ to: expectedTransferTarget });
  });

  it('on uncached asset-manager, fetches via getObject before building the tx', async () => {
    // Cache is reset in beforeEach. This must trigger the fetch path.
    const getObjectSpy = vi
      .spyOn(suiSpoke.publicClient, 'getObject')
      .mockResolvedValueOnce(makeGetObjectResult(SUI_ASSET_MGR_PKG));

    const result = await suiSpoke.deposit(depositParams<true>({ token: SUI_NATIVE, raw: true }));

    expect(getObjectSpy).toHaveBeenCalledWith({
      id: SUI_ASSET_MGR_CONFIG_ID,
      options: { showContent: true },
    });
    expect(result.to).toBe(expectedTransferTarget);
  });
});

// =========================================================================
// 12. sendMessage — raw vs walletProvider, dstChainKey-driven relay id
// =========================================================================

describe('SuiSpokeService.sendMessage', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<typeof SUI, Raw>>,
  ): SendMessageParams<typeof SUI, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: SUI,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: false,
      walletProvider: mockSuiProvider,
      ...overrides,
    }) as SendMessageParams<typeof SUI, Raw>;

  const expectedConnectionTarget = `${SUI_CONN_PKG}::${SUI_CONN_MOD}::send_message_ua`;

  it('raw=true → rawTx targets <connection>::send_message_ua with value=0n', async () => {
    const result = await suiSpoke.sendMessage(sendMessageParams<true>({ raw: true }));

    expect(result.from).toBe(SRC_ADDR);
    expect(result.to).toBe(expectedConnectionTarget);
    expect(result.value).toBe(0n);
    expect(typeof result.data).toBe('string');
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('raw=false → delegates to walletProvider.signAndExecuteTxn and returns its digest', async () => {
    (mockSuiProvider.signAndExecuteTxn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_DIGEST);

    const result = await suiSpoke.sendMessage(
      sendMessageParams<false>({ raw: false, walletProvider: mockSuiProvider }),
    );

    expect(result).toBe(TX_DIGEST);
    expect(mockSuiProvider.signAndExecuteTxn).toHaveBeenCalledWith(expect.any(Transaction));
  });

  it('Sonic dst pins getIntentRelayChainId(SONIC) === 146n', () => {
    // Defensive guard against the relay-id table drifting; the rawTx data field is base64-opaque
    // so we pin the table value directly rather than decoding bytes.
    expect(getIntentRelayChainId(SONIC)).toBe(146n);
  });
});

// =========================================================================
// 13. estimateGas — devInspect → effects.gasUsed (struct, not bigint)
// =========================================================================

describe('SuiSpokeService.estimateGas', () => {
  it('returns the gasUsed struct from devInspectTransactionBlock effects', async () => {
    // Build a real transaction-kind base64 so Transaction.fromKind(tx.data) succeeds locally.
    const realTx = new Transaction();
    realTx.setSender(SRC_ADDR);
    const kindBytes = await realTx.build({ client: suiSpoke.publicClient, onlyTransactionKind: true });
    const kindB64 = Buffer.from(kindBytes).toString('base64');

    const gasUsed = {
      computationCost: '1000',
      storageCost: '2000',
      storageRebate: '500',
      nonRefundableStorageFee: '100',
    };
    const inspectSpy = vi
      .spyOn(suiSpoke.publicClient, 'devInspectTransactionBlock')
      .mockResolvedValueOnce({ effects: { gasUsed } } as never);

    const result = await suiSpoke.estimateGas({
      chainKey: SUI,
      tx: { from: SRC_ADDR, to: expectedTransferStub(), value: 0n, data: kindB64 },
    });

    expect(result).toBe(gasUsed);
    // sender must come from tx.from — proves the SUT threads tx.from into devInspect.
    expect(inspectSpy).toHaveBeenCalledWith(expect.objectContaining({ sender: SRC_ADDR }));
  });
});

// Helper for the estimateGas test — the `to` field on the raw tx is unused by the SUT's gas
// estimation but the type system requires a string. Using a real-shaped Move type string keeps
// the fixture honest.
function expectedTransferStub(): string {
  return `${SUI_ASSET_MGR_PKG}::${SUI_ASSET_MGR_MOD}::transfer`;
}

// =========================================================================
// 14. getDeposit — viewContract delegation + BCS U64 decode + malformed-result branches
// =========================================================================

describe('SuiSpokeService.getDeposit', () => {
  // Builds the inner SuiExecutionResult shape devInspectTransactionBlock would return for a
  // successful balance query. `bcs.U64.serialize(N).toBytes()` produces the same on-wire bytes
  // the SUT consumes via `bcs.U64.parse(Uint8Array.from(val))` — avoids endianness drift.
  const makeBalanceResult = (balance: bigint) => ({
    returnValues: [[Array.from(bcs.U64.serialize(balance).toBytes()), 'u64']],
  });

  it('decodes a BCS-U64 balance from devInspectTransactionBlock results', async () => {
    suiSpoke.assetManagerAddress = SUI_ASSET_MGR;
    vi.spyOn(suiSpoke.publicClient, 'devInspectTransactionBlock').mockResolvedValueOnce({
      results: [makeBalanceResult(7_500n)],
    } as never);

    const result = await suiSpoke.getDeposit({
      srcChainKey: SUI,
      srcAddress: SRC_ADDR,
      token: SUI_BNUSD,
    });

    expect(result).toBe(7_500n);
  });

  it('handles a zero balance', async () => {
    suiSpoke.assetManagerAddress = SUI_ASSET_MGR;
    vi.spyOn(suiSpoke.publicClient, 'devInspectTransactionBlock').mockResolvedValueOnce({
      results: [makeBalanceResult(0n)],
    } as never);

    const result = await suiSpoke.getDeposit({
      srcChainKey: SUI,
      srcAddress: SRC_ADDR,
      token: SUI_BNUSD,
    });

    expect(result).toBe(0n);
  });

  it('throws when returnValues is missing', async () => {
    suiSpoke.assetManagerAddress = SUI_ASSET_MGR;
    vi.spyOn(suiSpoke.publicClient, 'devInspectTransactionBlock').mockResolvedValueOnce({
      results: [{}],
    } as never);

    await expect(suiSpoke.getDeposit({ srcChainKey: SUI, srcAddress: SRC_ADDR, token: SUI_BNUSD })).rejects.toThrow(
      'Failed to get Balance',
    );
  });

  it('throws when returnValues[0] is not an array', async () => {
    suiSpoke.assetManagerAddress = SUI_ASSET_MGR;
    vi.spyOn(suiSpoke.publicClient, 'devInspectTransactionBlock').mockResolvedValueOnce({
      results: [{ returnValues: ['not-an-array'] }],
    } as never);

    await expect(suiSpoke.getDeposit({ srcChainKey: SUI, srcAddress: SRC_ADDR, token: SUI_BNUSD })).rejects.toThrow(
      'Failed to get Balance',
    );
  });

  it('throws when returnValues[0][0] is undefined', async () => {
    suiSpoke.assetManagerAddress = SUI_ASSET_MGR;
    vi.spyOn(suiSpoke.publicClient, 'devInspectTransactionBlock').mockResolvedValueOnce({
      results: [{ returnValues: [[undefined, 'u64']] }],
    } as never);

    await expect(suiSpoke.getDeposit({ srcChainKey: SUI, srcAddress: SRC_ADDR, token: SUI_BNUSD })).rejects.toThrow(
      'Failed to get Balance',
    );
  });
});

// =========================================================================
// 15. waitForTransactionReceipt — every result branch + polling defaults
// =========================================================================

describe('SuiSpokeService.waitForTransactionReceipt', () => {
  it('maps a successful waitForTransaction result to status:success with the whole receipt', async () => {
    const fakeReceipt = {
      digest: TX_DIGEST,
      effects: { status: { status: 'success' } },
    };
    vi.spyOn(suiSpoke.publicClient, 'waitForTransaction').mockResolvedValueOnce(fakeReceipt as never);

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'success') throw new Error('expected success');
    expect(result.value.receipt).toBe(fakeReceipt);
  });

  it('returns status:failure when effects are missing entirely', async () => {
    vi.spyOn(suiSpoke.publicClient, 'waitForTransaction').mockResolvedValueOnce({ digest: TX_DIGEST } as never);

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error.message).toContain(`Transaction effects unavailable for digest=${TX_DIGEST}`);
  });

  it('returns status:failure when effects.status.status === "failure" with a known error', async () => {
    vi.spyOn(suiSpoke.publicClient, 'waitForTransaction').mockResolvedValueOnce({
      digest: TX_DIGEST,
      effects: { status: { status: 'failure', error: 'MoveAbort' } },
    } as never);

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'failure') throw new Error('expected failure');
    expect(result.value.error.message).toBe('Transaction failed: MoveAbort');
  });

  it('falls back to "unknown" when effects.status.error is undefined (the `?? "unknown"` branch)', async () => {
    vi.spyOn(suiSpoke.publicClient, 'waitForTransaction').mockResolvedValueOnce({
      digest: TX_DIGEST,
      effects: { status: { status: 'failure' } },
    } as never);

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok || result.value.status !== 'failure') throw new Error('expected ok+failure');
    expect(result.value.error.message).toBe('Transaction failed: unknown');
  });

  it('returns status:timeout when the thrown error message contains "timeout"', async () => {
    const timeoutErr = new Error('waitForTransaction timeout exceeded');
    vi.spyOn(suiSpoke.publicClient, 'waitForTransaction').mockRejectedValueOnce(timeoutErr);

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
    if (result.value.status !== 'timeout') return;
    expect(result.value.error).toBe(timeoutErr);
  });

  it('returns status:failure for non-timeout Error throws', async () => {
    const otherErr = new Error('connection refused');
    vi.spyOn(suiSpoke.publicClient, 'waitForTransaction').mockRejectedValueOnce(otherErr);

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error).toBe(otherErr);
  });

  it('wraps non-Error throws into a new Error(String(thrown))', async () => {
    vi.spyOn(suiSpoke.publicClient, 'waitForTransaction').mockRejectedValueOnce('boom');

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error).toBeInstanceOf(Error);
    expect(result.value.error.message).toBe('boom');
  });

  it('forwards real config-driven polling/timeout defaults when caller omits them', async () => {
    const spy = vi.spyOn(suiSpoke.publicClient, 'waitForTransaction').mockResolvedValueOnce({
      digest: TX_DIGEST,
      effects: { status: { status: 'success' } },
    } as never);

    await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    expect(spy).toHaveBeenCalledWith({
      digest: TX_DIGEST,
      // Pinned to the REAL suiConfig.pollingConfig values, not magic numbers — a config change
      // that drops or renames either field surfaces here.
      timeout: SUI_TIMEOUT_MS,
      pollInterval: SUI_POLLING_MS,
      options: { showEffects: true },
    });
  });

  it('forwards custom pollingIntervalMs / maxTimeoutMs when caller provides them', async () => {
    const spy = vi.spyOn(suiSpoke.publicClient, 'waitForTransaction').mockResolvedValueOnce({
      digest: TX_DIGEST,
      effects: { status: { status: 'success' } },
    } as never);

    await suiSpoke.waitForTransactionReceipt({
      chainKey: SUI,
      txHash: TX_DIGEST,
      pollingIntervalMs: 123,
      maxTimeoutMs: 4_567,
    });

    expect(spy).toHaveBeenCalledWith({
      digest: TX_DIGEST,
      // Sui SDK names: `pollInterval` (not `pollingInterval`), `timeout` (same as viem).
      timeout: 4_567,
      pollInterval: 123,
      options: { showEffects: true },
    });
  });
});
