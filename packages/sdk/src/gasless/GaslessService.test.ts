/**
 * Unit tests for GaslessService (Mode B).
 *
 * Mirrors BridgeService.test.ts: the viem account-abstraction layer is isolated behind the
 * `executeUserOp` seam and `vi.mock`ed, and the relay (`relayTxAndWaitPacket`) is `vi.mock`ed, so
 * the tests exercise validation + orchestration offline. A real `Sodax` (configured with gasless
 * endpoints for BSC) backs every test; `buildDepositCalls` and EVM `verifyTxHash` run for real.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, EvmSpokeOnlyChainKey, Hex } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import type { GaslessDepositParams } from './GaslessTypes.js';

const mocks = vi.hoisted(() => ({
  executeUserOp: vi.fn(),
  relayTxAndWaitPacket: vi.fn(),
}));

vi.mock('./internal/userOpExecutor.js', () => ({
  executeUserOp: mocks.executeUserOp,
}));

vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return { ...actual, relayTxAndWaitPacket: mocks.relayTxAndWaitPacket };
});

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
