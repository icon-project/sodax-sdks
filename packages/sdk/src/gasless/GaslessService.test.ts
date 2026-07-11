/**
 * Unit tests for GaslessService (Mode A + Mode B).
 *
 * Mirrors BridgeService.test.ts: the executors (`executeUserOp` Mode B, `executeSendCalls` Mode A)
 * and the relay (`relayTxAndWaitPacket`) are `vi.mock`ed, so the tests exercise validation, mode
 * detection, and orchestration offline. A real `Sodax` (configured with gasless endpoints for BSC)
 * backs every test; `buildDepositCalls` and EVM `verifyTxHash` run for real.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, EvmSpokeOnlyChainKey, Hex, IGaslessCapableEvmWalletProvider } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import type { GaslessDepositParams } from './GaslessTypes.js';

const mocks = vi.hoisted(() => ({
  executeUserOp: vi.fn(),
  executeSendCalls: vi.fn(),
  relayTxAndWaitPacket: vi.fn(),
}));

vi.mock('./internal/userOpExecutor.js', () => ({
  executeUserOp: mocks.executeUserOp,
}));

vi.mock('./internal/sendCallsExecutor.js', () => ({
  executeSendCalls: mocks.executeSendCalls,
}));

vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return { ...actual, relayTxAndWaitPacket: mocks.relayTxAndWaitPacket };
});

/** Mock external EIP-5792 wallet. `caps` controls what `wallet_getCapabilities` advertises. */
const makeCapableWallet = (
  caps: unknown = { atomic: { status: 'supported' }, paymasterService: { supported: true } },
): IGaslessCapableEvmWalletProvider =>
  ({
    chainType: 'EVM',
    getCapabilities: vi.fn().mockResolvedValue(caps),
    sendCalls: vi.fn(),
    waitForCallsStatus: vi.fn(),
    getWalletAddress: vi.fn().mockResolvedValue(OWNER.address),
    sendTransaction: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  }) as unknown as IGaslessCapableEvmWalletProvider;

const BSC = '0x38.bsc' satisfies EvmSpokeOnlyChainKey;
const ARBITRUM = '0xa4b1.arbitrum' satisfies EvmSpokeOnlyChainKey; // intentionally NOT gasless-configured

const PAYMASTER_URL = 'https://paymaster.example/bsc';
const BUNDLER_URL = 'https://bundler.example/bsc';

const sodax = new Sodax({
  gasless: {
    chains: {
      [BSC]: { paymasterUrl: PAYMASTER_URL, bundlerUrl: BUNDLER_URL, supports7702: true },
    },
  },
});

const OWNER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const TOKEN = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' as Address;
const HUB_RECIPIENT = '0x1111111111111111111111111111111111111111' as Address;
const DATA = '0xdeadbeef' as Hex;
const SRC_TX = '0xaaaa000000000000000000000000000000000000000000000000000000000001';
const DST_TX = '0xbbbb000000000000000000000000000000000000000000000000000000000002';

const params = (overrides: Partial<GaslessDepositParams> = {}): GaslessDepositParams => ({
  srcChainKey: BSC,
  srcAddress: OWNER.address,
  token: TOKEN,
  amount: 1_000_000n,
  to: HUB_RECIPIENT,
  data: DATA,
  owner: OWNER,
  ...overrides,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GaslessService.isGaslessSupported', () => {
  it('is true for a gasless-configured chain and false otherwise', () => {
    expect(sodax.gasless.isGaslessSupported(BSC)).toBe(true);
    expect(sodax.gasless.isGaslessSupported(ARBITRUM)).toBe(false);
  });
});

describe('GaslessService.deposit — happy path', () => {
  it('runs the sponsored batch and relays the extracted tx hash', async () => {
    mocks.executeUserOp.mockResolvedValue({ srcChainTxHash: SRC_TX });
    mocks.relayTxAndWaitPacket.mockResolvedValue({ ok: true, value: { dst_tx_hash: DST_TX } });

    const result = await sodax.gasless.deposit(params());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ srcChainTxHash: SRC_TX, dstChainTxHash: DST_TX });
    }

    // Executor received the configured endpoints, the owner, and a 2-call batch [approve, transfer].
    const assetManager = sodax.config.getChainConfig(BSC).addresses.assetManager;
    expect(mocks.executeUserOp).toHaveBeenCalledTimes(1);
    const call = mocks.executeUserOp.mock.calls[0][0];
    expect(call.bundlerUrl).toBe(BUNDLER_URL);
    expect(call.paymasterUrl).toBe(PAYMASTER_URL);
    expect(call.owner).toBe(OWNER);
    expect(call.calls).toHaveLength(2);
    expect(call.calls[0].to).toBe(TOKEN); // approve on the token
    expect(call.calls[1].to).toBe(assetManager); // transfer on the asset manager

    // Relay was called with the extracted hash + relayData for the hub recipient.
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        srcTxHash: SRC_TX,
        data: { address: HUB_RECIPIENT, payload: DATA },
        chainKey: BSC,
        relayerApiEndpoint: sodax.config.relay.relayerApiEndpoint,
      }),
    );
  });
});

describe('GaslessService.deposit — validation (never touches the executor/relay)', () => {
  it('rejects the native token', async () => {
    const nativeToken = sodax.config.getChainConfig(BSC).nativeToken as Address;
    const result = await sodax.gasless.deposit(params({ token: nativeToken }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.executeUserOp).not.toHaveBeenCalled();
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('rejects when owner.address does not match srcAddress', async () => {
    const result = await sodax.gasless.deposit(
      params({ srcAddress: '0x9999999999999999999999999999999999999999' as Address }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.executeUserOp).not.toHaveBeenCalled();
  });

  it('rejects a chain that is not gasless-configured', async () => {
    const result = await sodax.gasless.deposit(params({ srcChainKey: ARBITRUM }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.executeUserOp).not.toHaveBeenCalled();
  });

  it('rejects a zero amount', async () => {
    const result = await sodax.gasless.deposit(params({ amount: 0n }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.executeUserOp).not.toHaveBeenCalled();
  });
});

describe('GaslessService.deposit — relay failure', () => {
  it('maps a relay failure to a gasless orchestration error', async () => {
    mocks.executeUserOp.mockResolvedValue({ srcChainTxHash: SRC_TX });
    mocks.relayTxAndWaitPacket.mockResolvedValue({ ok: false, error: new Error('RELAY_TIMEOUT') });

    const result = await sodax.gasless.deposit(params());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.feature).toBe('gasless');
      expect(result.error.context?.action).toBe('deposit');
    }
  });
});

describe('GaslessService.createGaslessDepositIntent', () => {
  it('returns the tx hash + relayData without relaying', async () => {
    mocks.executeUserOp.mockResolvedValue({ srcChainTxHash: SRC_TX });

    const result = await sodax.gasless.createGaslessDepositIntent(params());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ srcChainTxHash: SRC_TX, relayData: { address: HUB_RECIPIENT, payload: DATA } });
    }
    expect(mocks.executeUserOp).toHaveBeenCalledTimes(1);
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });
});

describe('GaslessService.deposit — Mode A (external wallet)', () => {
  it('runs sendCalls and relays the extracted hash when the wallet is capable', async () => {
    mocks.executeSendCalls.mockResolvedValue({ srcChainTxHash: SRC_TX });
    mocks.relayTxAndWaitPacket.mockResolvedValue({ ok: true, value: { dst_tx_hash: DST_TX } });
    const wallet = makeCapableWallet();

    const result = await sodax.gasless.deposit(params({ owner: undefined, walletProvider: wallet }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ srcChainTxHash: SRC_TX, dstChainTxHash: DST_TX });

    expect(mocks.executeSendCalls).toHaveBeenCalledTimes(1);
    const call = mocks.executeSendCalls.mock.calls[0][0];
    expect(call.wallet).toBe(wallet);
    expect(call.paymasterUrl).toBe(PAYMASTER_URL);
    expect(call.calls).toHaveLength(2);
    expect(call.chainId).toBe(Number(sodax.config.getChainConfig(BSC).chain.chainId)); // forwarded for the wrong-chain guard
    expect(mocks.executeUserOp).not.toHaveBeenCalled();
  });

  it('returns a typed error when the wallet lacks atomic/paymaster support (no fallback)', async () => {
    const wallet = makeCapableWallet({ atomic: { status: 'unsupported' } });

    const result = await sodax.gasless.deposit(params({ owner: undefined, walletProvider: wallet }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.context?.reason).toBe('gasless-unsupported');
    }
    expect(mocks.executeSendCalls).not.toHaveBeenCalled();
  });
});

describe('GaslessService.deposit — signer invariant', () => {
  it('rejects when both owner and walletProvider are provided', async () => {
    const result = await sodax.gasless.deposit(params({ walletProvider: makeCapableWallet() }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects when neither owner nor walletProvider is provided', async () => {
    const result = await sodax.gasless.deposit(params({ owner: undefined }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GaslessService.deposit — allowGasFallback', () => {
  it('degrades to the normal approve+deposit flow when gasless is unavailable', async () => {
    const wallet = makeCapableWallet({ atomic: { status: 'unsupported' } });
    vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValue({ ok: true, value: false });
    const approveSpy = vi.spyOn(sodax.spoke, 'approve').mockResolvedValue({ ok: true, value: '0xapprovetx' } as never);
    const depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({ ok: true, value: SRC_TX } as never);
    mocks.relayTxAndWaitPacket.mockResolvedValue({ ok: true, value: { dst_tx_hash: DST_TX } });

    const result = await sodax.gasless.deposit(
      params({ owner: undefined, walletProvider: wallet, allowGasFallback: true }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ srcChainTxHash: SRC_TX, dstChainTxHash: DST_TX });
    expect(approveSpy).toHaveBeenCalledTimes(1);
    expect(depositSpy).toHaveBeenCalledTimes(1);
    expect(mocks.executeSendCalls).not.toHaveBeenCalled();
    expect(mocks.executeUserOp).not.toHaveBeenCalled();
  });

  it('skips approve in the fallback when allowance is already valid', async () => {
    const wallet = makeCapableWallet({ atomic: { status: 'unsupported' } });
    vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValue({ ok: true, value: true });
    const approveSpy = vi.spyOn(sodax.spoke, 'approve');
    const depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({ ok: true, value: SRC_TX } as never);
    mocks.relayTxAndWaitPacket.mockResolvedValue({ ok: true, value: { dst_tx_hash: DST_TX } });

    const result = await sodax.gasless.deposit(
      params({ owner: undefined, walletProvider: wallet, allowGasFallback: true }),
    );

    expect(result.ok).toBe(true);
    expect(approveSpy).not.toHaveBeenCalled();
    expect(depositSpy).toHaveBeenCalledTimes(1);
  });
});

describe('GaslessService.getGaslessCapabilities', () => {
  it('reports walletCalls for a capable wallet on a configured chain', async () => {
    const result = await sodax.gasless.getGaslessCapabilities({ chainKey: BSC, walletProvider: makeCapableWallet() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.resolvedMode).toBe('walletCalls');
  });

  it('reports smartAccount for an owner on a configured chain', async () => {
    const result = await sodax.gasless.getGaslessCapabilities({ chainKey: BSC, owner: OWNER });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.resolvedMode).toBe('smartAccount');
  });

  it('reports unsupported for an unconfigured chain', async () => {
    const result = await sodax.gasless.getGaslessCapabilities({ chainKey: ARBITRUM, owner: OWNER });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.resolvedMode).toBe('unsupported');
  });
});
