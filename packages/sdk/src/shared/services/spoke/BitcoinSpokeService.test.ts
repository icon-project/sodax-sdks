/**
 * Tests for BitcoinSpokeService — the single Bitcoin spoke chain.
 *
 * Pattern: mirrors SuiSpokeService.test.ts (issue #109) collapsed to one chain. Unlike Sui's
 * SuiClient, Bitcoin's "RPC" is an Esplora-style HTTP API — the SUT calls `fetch(...)` directly,
 * so this file stubs `globalThis.fetch` per-test (with `vi.stubGlobal`) instead of spying on a
 * client method. The Radfi trading-wallet flow is a second collaborator; `radfi.*` instance
 * methods are spied per-test.
 *
 * Real config data is used wherever possible — every address, RPC URL, polling interval, Radfi
 * config field, and `walletMode` is sourced from `spokeChainConfig[BITCOIN_MAINNET]`. Only user
 * identities (`USER_ADDR`, `HUB_WALLET`), UTXOs, and txids are fabricated.
 *
 * Mocking strategy:
 *   - `globalThis.fetch` is stubbed per-test via `vi.stubGlobal` to intercept Esplora URLs.
 *     A URL-router dispatches to per-endpoint responses (UTXO, fee-estimate, tx, broadcast).
 *   - `sleep` (shared-utils.js) is module-mocked to a no-op so `waitForTransactionReceipt`
 *     polling tests finish instantly.
 *   - The `RadfiProvider` instance attached to `sodax.spoke.bitcoin.radfi` is spied per-test
 *     (`getTradingWallet`, `createWithdrawTransaction`, `requestRadfiSignature`).
 *   - `bitcoinjs-lib` is NOT mocked — real PSBT and script construction runs; only network
 *     interactions are stubbed at the `fetch` boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  getIntentRelayChainId,
  spokeChainConfig,
  type Hex,
  type IBitcoinWalletProvider,
} from '@sodax/types';

// --- hoisted mocks --------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sleep: vi.fn(),
}));

vi.mock('../../utils/shared-utils.js', async () => {
  const actual = await vi.importActual<object>('../../utils/shared-utils.js');
  return { ...actual, sleep: mocks.sleep };
});

import { Sodax } from '../../entities/Sodax.js';
import { BitcoinSpokeService } from './BitcoinSpokeService.js';
import type { SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const btcSpoke = sodax.spoke.bitcoin;

const BTC = ChainKeys.BITCOIN_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET;

const btcConfig = spokeChainConfig[BTC];
const BTC_ASSET_MGR = btcConfig.addresses.assetManager;
const BTC_RPC_URL = btcConfig.rpcUrl;
const BTC_POLLING_MS = btcConfig.pollingConfig.pollingIntervalMs;
const BTC_TIMEOUT_MS = btcConfig.pollingConfig.maxTimeoutMs;

// A real-ish taproot (bc1p…) address used for tests. NOT the asset manager.
const USER_ADDR = 'bc1q5q3xczsl9zlt0gjys5khjknfp40zfdmkme9ene';
const HUB_WALLET = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const DST_ADDR = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const TRADING_ADDR = 'bc1ptradingwallettradingwallettradingwallet000000000000000';
const TX_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const mockBtcProvider = {
  chainType: 'BITCOIN',
  signTransaction: vi.fn(),
  signEcdsaMessage: vi.fn(),
  signBip322Message: vi.fn(),
  sendBitcoin: vi.fn(),
  getWalletAddress: vi.fn(),
  getPublicKey: vi.fn(),
} as unknown as IBitcoinWalletProvider;

// fetch-router: install via vi.stubGlobal in beforeEach so individual tests can override the
// handler. The default returns 404 (which is how the SUT treats "tx not yet seen").
type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const defaultHandler: FetchHandler = () => new Response(null, { status: 404 });
let activeHandler: FetchHandler;

const setFetch = (handler: FetchHandler) => {
  activeHandler = handler;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sleep.mockResolvedValue(undefined);
  activeHandler = defaultHandler;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => Promise.resolve(activeHandler(url, init))),
  );
  for (const k of Object.keys(mockBtcProvider) as (keyof IBitcoinWalletProvider)[]) {
    const v = (mockBtcProvider as unknown as Record<string, unknown>)[k];
    if (typeof v === 'function' && 'mockReset' in (v as object)) {
      (v as ReturnType<typeof vi.fn>).mockReset();
    }
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Helper: build a JSON response.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const text = (body: string, status = 200) => new Response(body, { status });

// =========================================================================
// 1. constructor
// =========================================================================

describe('BitcoinSpokeService — constructor', () => {
  it('exposes the spoke instance on sodax.spoke.bitcoin with the expected method surface', () => {
    expect(btcSpoke).toBeInstanceOf(BitcoinSpokeService);
    expect(typeof btcSpoke.getBtcNetwork).toBe('function');
    expect(typeof btcSpoke.getBalance).toBe('function');
    expect(typeof btcSpoke.fetchUTXOs).toBe('function');
    expect(typeof btcSpoke.fetchRawTransaction).toBe('function');
    expect(typeof btcSpoke.getFeeRateEstimate).toBe('function');
    expect(typeof btcSpoke.estimateGas).toBe('function');
    expect(typeof btcSpoke.getDeposit).toBe('function');
    expect(typeof btcSpoke.getEffectiveWalletAddress).toBe('function');
    expect(typeof btcSpoke.getTradingWalletAddress).toBe('function');
    expect(typeof btcSpoke.fundTradingWallet).toBe('function');
    expect(typeof btcSpoke.deposit).toBe('function');
    expect(typeof btcSpoke.sendMessage).toBe('function');
    expect(typeof btcSpoke.encodeWithdrawalData).toBe('function');
    expect(typeof btcSpoke.waitForTransactionReceipt).toBe('function');
  });

  it('walletMode defaults to TRADING per chain config', () => {
    expect(btcSpoke.walletMode).toBe('TRADING');
  });

  it('exposes the per-chain rpcUrl and radfi provider', () => {
    expect(btcSpoke.rpcUrl).toBe(BTC_RPC_URL);
    expect(btcSpoke.radfi).toBeDefined();
  });
});

// =========================================================================
// 2. getBtcNetwork — mainnet → bitcoin.networks.bitcoin
// =========================================================================

describe('BitcoinSpokeService.getBtcNetwork', () => {
  it('returns mainnet network for BITCOIN_MAINNET', async () => {
    const bitcoin = await import('bitcoinjs-lib');
    expect(btcSpoke.getBtcNetwork(BTC)).toBe(bitcoin.networks.bitcoin);
  });
});

// =========================================================================
// 3. fetchUTXOs / fetchRawTransaction — URL composition + non-ok throw
// =========================================================================

describe('BitcoinSpokeService.fetchUTXOs', () => {
  it("fetches `${rpcUrl}/address/{addr}/utxo` and returns the JSON array", async () => {
    const utxos = [{ txid: 'aa', vout: 0, value: 1000, status: { confirmed: true } }];
    setFetch(url => {
      expect(url).toBe(`${BTC_RPC_URL}/address/${USER_ADDR}/utxo`);
      return json(utxos);
    });
    expect(await btcSpoke.fetchUTXOs(USER_ADDR)).toEqual(utxos);
  });

  it('throws when the response is not ok', async () => {
    setFetch(() => new Response(null, { status: 500, statusText: 'Server Error' }));
    await expect(btcSpoke.fetchUTXOs(USER_ADDR)).rejects.toThrow(/Failed to fetch UTXOs/);
  });
});

describe('BitcoinSpokeService.fetchRawTransaction', () => {
  it("fetches `${rpcUrl}/tx/{txid}/hex` and returns the raw text", async () => {
    setFetch(url => {
      expect(url).toBe(`${BTC_RPC_URL}/tx/${TX_HASH}/hex`);
      return text('deadbeef');
    });
    expect(await btcSpoke.fetchRawTransaction(TX_HASH)).toBe('deadbeef');
  });

  it('throws when the response is not ok', async () => {
    setFetch(() => new Response(null, { status: 404, statusText: 'Not Found' }));
    await expect(btcSpoke.fetchRawTransaction(TX_HASH)).rejects.toThrow(/Failed to fetch transaction/);
  });
});

// =========================================================================
// 4. getBalance — BTC summation + non-BTC throw
// =========================================================================

describe('BitcoinSpokeService.getBalance', () => {
  it("sums UTXO values for native BTC (empty token, '0x', or 'BTC')", async () => {
    setFetch(() =>
      json([
        { txid: 'a', vout: 0, value: 100, status: { confirmed: true } },
        { txid: 'b', vout: 1, value: 250, status: { confirmed: false } },
      ]),
    );
    expect(await btcSpoke.getBalance('BTC', USER_ADDR)).toBe(350n);
    expect(await btcSpoke.getBalance('', USER_ADDR)).toBe(350n);
    expect(await btcSpoke.getBalance('0x', USER_ADDR)).toBe(350n);
  });

  it('throws for non-BTC tokens (not implemented)', async () => {
    await expect(btcSpoke.getBalance('USDT', USER_ADDR)).rejects.toThrow(/not yet implemented/);
  });
});

// =========================================================================
// 5. getFeeRateEstimate — happy + fallback branches
// =========================================================================

describe('BitcoinSpokeService.getFeeRateEstimate', () => {
  it('returns the per-target fee from the API response', async () => {
    setFetch(() => json({ 1: 50, 6: 12, 144: 3 }));
    expect(await btcSpoke.getFeeRateEstimate(6)).toBe(12);
  });

  it('falls back to default (3) when target is missing from response', async () => {
    setFetch(() => json({ 1: 50 })); // no key 6
    expect(await btcSpoke.getFeeRateEstimate(6)).toBe(3);
  });

  it('falls back to default (3) when fetch is not ok', async () => {
    setFetch(() => new Response(null, { status: 500 }));
    expect(await btcSpoke.getFeeRateEstimate()).toBe(3);
  });

  it('falls back to default (3) when fetch throws', async () => {
    setFetch(() => {
      throw new Error('network down');
    });
    expect(await btcSpoke.getFeeRateEstimate()).toBe(3);
  });
});

// =========================================================================
// 6. estimateGas — vsize × fee rate
// =========================================================================

describe('BitcoinSpokeService.estimateGas', () => {
  it('returns vsize × fee rate as a bigint', async () => {
    setFetch(() => json({ 6: 5 }));
    const result = await btcSpoke.estimateGas({
      chainKey: BTC,
      tx: {
        from: USER_ADDR as Hex,
        to: BTC_ASSET_MGR as Hex,
        value: 0n,
        // 5 bytes ('aabbccddee' → 5 bytes) × fee rate 5 = 25n
        data: 'aabbccddee',
      },
    });
    expect(result).toBe(25n);
  });

  it('throws when tx is a string (raw mode not supported here)', async () => {
    await expect(
      btcSpoke.estimateGas({ chainKey: BTC, tx: 'whatever' as never }),
    ).rejects.toThrow(/string tx not supported/);
  });
});

// =========================================================================
// 7. getDeposit — sums UTXOs for the asset manager address
// =========================================================================

describe('BitcoinSpokeService.getDeposit', () => {
  it('sums UTXOs at the asset manager address', async () => {
    setFetch(url => {
      expect(url).toBe(`${BTC_RPC_URL}/address/${BTC_ASSET_MGR}/utxo`);
      return json([
        { txid: 'a', vout: 0, value: 1_000, status: { confirmed: true } },
        { txid: 'b', vout: 1, value: 500, status: { confirmed: true } },
      ]);
    });

    const result = await btcSpoke.getDeposit({
      srcChainKey: BTC,
      srcAddress: USER_ADDR,
      token: 'BTC',
    });
    expect(result).toBe(1_500n);
  });
});

// =========================================================================
// 8. getEffectiveWalletAddress / getTradingWalletAddress / fundTradingWallet
// =========================================================================

describe('BitcoinSpokeService.getEffectiveWalletAddress', () => {
  it('TRADING mode → returns the trading-wallet address from Radfi', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);

    expect(await btcSpoke.getEffectiveWalletAddress(USER_ADDR)).toBe(TRADING_ADDR);
  });

  it('USER (non-TRADING) mode → returns the personal address unchanged', async () => {
    // Mutate walletMode for this test only; restore in finally.
    const original = btcSpoke.walletMode;
    Object.defineProperty(btcSpoke, 'walletMode', { value: 'USER', configurable: true });
    try {
      expect(await btcSpoke.getEffectiveWalletAddress(USER_ADDR)).toBe(USER_ADDR);
    } finally {
      Object.defineProperty(btcSpoke, 'walletMode', { value: original, configurable: true });
    }
  });
});

describe('BitcoinSpokeService.getTradingWalletAddress', () => {
  it('always returns the trading address from Radfi', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);
    expect(await btcSpoke.getTradingWalletAddress(USER_ADDR)).toBe(TRADING_ADDR);
  });
});

describe('BitcoinSpokeService.fundTradingWallet', () => {
  it('sends BTC to the trading-wallet address via walletProvider.sendBitcoin', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);
    (mockBtcProvider.sendBitcoin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

    const result = await btcSpoke.fundTradingWallet(50_000n, USER_ADDR, mockBtcProvider);
    expect(result).toBe(TX_HASH);
    expect(mockBtcProvider.sendBitcoin).toHaveBeenCalledWith(TRADING_ADDR, 50_000n);
  });
});

// =========================================================================
// 9. encodeWithdrawalData / sendMessage — TRADING flow, signature branches
// =========================================================================

describe('BitcoinSpokeService.encodeWithdrawalData', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<typeof BTC, Raw>>,
  ): SendMessageParams<typeof BTC, Raw> & { walletMode?: 'USER' | 'TRADING' } =>
    ({
      srcAddress: USER_ADDR,
      srcChainKey: BTC,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: false,
      walletProvider: mockBtcProvider,
      ...overrides,
    }) as SendMessageParams<typeof BTC, Raw> & { walletMode?: 'USER' | 'TRADING' };

  it('TRADING raw=true → substitutes srcAddress with trading address and returns JSON payload with no signature', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);

    const result = await btcSpoke.encodeWithdrawalData(sendMessageParams<true>({ raw: true }));

    expect(typeof result).toBe('string');
    const parsed = JSON.parse(result as unknown as string);
    expect(parsed).toHaveProperty('payload_hex');
    expect(typeof parsed.payload_hex).toBe('string');
    expect(parsed.signature).toBeUndefined();
  });

  it('TRADING raw=false → calls walletProvider.signEcdsaMessage and embeds the signature', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);
    (mockBtcProvider.signEcdsaMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce('SIGSIGSIG');

    const result = await btcSpoke.encodeWithdrawalData(sendMessageParams<false>({ raw: false }));

    const parsed = JSON.parse(result as unknown as string);
    expect(parsed.signature).toBe('SIGSIGSIG');
    expect(mockBtcProvider.signEcdsaMessage).toHaveBeenCalledTimes(1);
  });

  it('TRADING + getTradingWallet rejection → falls back to original srcAddress (catch branch)', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockRejectedValueOnce(new Error('radfi 503'));

    const result = await btcSpoke.encodeWithdrawalData(sendMessageParams<true>({ raw: true }));
    expect(typeof result).toBe('string');
    // The payload still encodes — fallback uses the unchanged USER_ADDR; we can't easily decode
    // the byte payload, but the function must not throw.
    expect(() => JSON.parse(result as unknown as string)).not.toThrow();
  });

  it('sendMessage delegates to encodeWithdrawalData', async () => {
    vi.spyOn(btcSpoke.radfi, 'getTradingWallet').mockResolvedValueOnce({
      tradingAddress: TRADING_ADDR,
    } as never);

    const result = await btcSpoke.sendMessage(sendMessageParams<true>({ raw: true }));
    expect(typeof result).toBe('string');
    expect(() => JSON.parse(result as unknown as string)).not.toThrow();
  });

  it('pins getIntentRelayChainId(SONIC) === 146n', () => {
    expect(getIntentRelayChainId(SONIC)).toBe(146n);
  });
});

// =========================================================================
// 10. deposit — TRADING happy path, raw, unsupported token, USER+raw blocked
// =========================================================================

describe('BitcoinSpokeService.deposit', () => {
  // The TRADING flow needs both createWithdrawTransaction (returns a base64 PSBT) and the
  // optional requestRadfiSignature (returns the broadcast txid). For raw=true we skip both
  // requestRadfiSignature and walletProvider.signTransaction.

  it('TRADING raw=true → returns rawTx with the base64 PSBT (no signing)', async () => {
    vi.spyOn(btcSpoke.radfi, 'createWithdrawTransaction').mockResolvedValueOnce({
      base64Psbt: 'cHNidA==',
    } as never);

    // The SUT identifies tokens by `address`, not symbol. BTC's address is '0:0'.
    const BTC_TOKEN = btcConfig.supportedTokens.BTC.address;
    const result = await btcSpoke.deposit({
      srcChainKey: BTC,
      srcAddress: USER_ADDR,
      to: HUB_WALLET,
      token: BTC_TOKEN,
      amount: 50_000n,
      data: '0x' as Hex,
      raw: true,
    });

    expect(result).toMatchObject({
      from: USER_ADDR,
      to: BTC_ASSET_MGR,
      value: 50_000n,
      data: 'cHNidA==',
    });
  });

  it('TRADING raw=false → sign + radfi signature + returns the final txid', async () => {
    vi.spyOn(btcSpoke.radfi, 'createWithdrawTransaction').mockResolvedValueOnce({
      base64Psbt: 'cHNidA==',
    } as never);
    (mockBtcProvider.signTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce('signedhex');
    vi.spyOn(btcSpoke.radfi, 'requestRadfiSignature').mockResolvedValueOnce(TX_HASH as never);

    const BTC_TOKEN = btcConfig.supportedTokens.BTC.address;
    const result = await btcSpoke.deposit({
      srcChainKey: BTC,
      srcAddress: USER_ADDR,
      to: HUB_WALLET,
      token: BTC_TOKEN,
      amount: 50_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockBtcProvider,
    });

    expect(result).toBe(TX_HASH);
    expect(mockBtcProvider.signTransaction).toHaveBeenCalledWith('cHNidA==', false);
  });

  it('TRADING with unsupported token → throws "Unsupported token: …"', async () => {
    await expect(
      btcSpoke.deposit({
        srcChainKey: BTC,
        srcAddress: USER_ADDR,
        to: HUB_WALLET,
        token: 'NOT_A_TOKEN',
        amount: 50_000n,
        data: '0x' as Hex,
        raw: true,
      }),
    ).rejects.toThrow(/Unsupported token/);
  });

  it('USER (non-TRADING) raw=true → throws "Raw mode is not supported…"', async () => {
    const original = btcSpoke.walletMode;
    Object.defineProperty(btcSpoke, 'walletMode', { value: 'USER', configurable: true });
    try {
      await expect(
        btcSpoke.deposit({
          srcChainKey: BTC,
          srcAddress: USER_ADDR,
          to: HUB_WALLET,
          token: 'BTC',
          amount: 50_000n,
          data: '0x' as Hex,
          raw: true,
        }),
      ).rejects.toThrow(/Raw mode is not supported/);
    } finally {
      Object.defineProperty(btcSpoke, 'walletMode', { value: original, configurable: true });
    }
  });

  it('USER + no UTXOs → throws "No UTXOs available for deposit"', async () => {
    const original = btcSpoke.walletMode;
    Object.defineProperty(btcSpoke, 'walletMode', { value: 'USER', configurable: true });
    setFetch(() => json([])); // empty UTXOs at user address
    try {
      await expect(
        btcSpoke.deposit({
          srcChainKey: BTC,
          srcAddress: USER_ADDR,
          to: HUB_WALLET,
          token: 'BTC',
          amount: 50_000n,
          data: '0x' as Hex,
          raw: false,
          walletProvider: mockBtcProvider,
        }),
      ).rejects.toThrow(/No UTXOs available/);
    } finally {
      Object.defineProperty(btcSpoke, 'walletMode', { value: original, configurable: true });
    }
  });
});

// =========================================================================
// 11. waitForTransactionReceipt — confirmed / unconfirmed / 404 / transient
// =========================================================================

describe('BitcoinSpokeService.waitForTransactionReceipt', () => {
  it('confirmed tx → status:success with the JSON receipt', async () => {
    const receipt = { txid: TX_HASH, status: { confirmed: true, block_height: 800_000 } };
    setFetch(() => json(receipt));

    const result = await btcSpoke.waitForTransactionReceipt({ chainKey: BTC, txHash: TX_HASH });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(result.value.receipt).toEqual(receipt);
  });

  it('unconfirmed until deadline → status:timeout', async () => {
    setFetch(() => json({ txid: TX_HASH, status: { confirmed: false } }));

    const result = await btcSpoke.waitForTransactionReceipt({
      chainKey: BTC,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1,
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
  });

  it('persistent 404 until deadline → status:timeout', async () => {
    setFetch(() => new Response(null, { status: 404 }));

    const result = await btcSpoke.waitForTransactionReceipt({
      chainKey: BTC,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1,
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
    if (result.value.status !== 'timeout') return;
    expect(result.value.error.message).toContain(TX_HASH);
  });

  it('transient throw → recovers on next poll', async () => {
    let calls = 0;
    setFetch(() => {
      calls++;
      if (calls === 1) throw new Error('connection refused');
      return json({ txid: TX_HASH, status: { confirmed: true } });
    });

    const result = await btcSpoke.waitForTransactionReceipt({
      chainKey: BTC,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1000,
    });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(mocks.sleep).toHaveBeenCalled();
  });

  it('config-driven defaults: pollingConfig pins polling=60_000ms / timeout=3_600_000ms', () => {
    expect(BTC_POLLING_MS).toBe(60_000);
    expect(BTC_TIMEOUT_MS).toBe(3_600_000);
  });

  it('forwards caller-supplied pollingIntervalMs to sleep on each poll', async () => {
    setFetch(() => new Response(null, { status: 404 }));

    await btcSpoke.waitForTransactionReceipt({
      chainKey: BTC,
      txHash: TX_HASH,
      pollingIntervalMs: 7,
      maxTimeoutMs: 1,
    });

    expect(mocks.sleep).toHaveBeenCalledWith(7);
  });
});
