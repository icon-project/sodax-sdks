/**
 * Unit tests for GaslessService (external-signer prepare/submit + Mode A sendCalls + relay).
 *
 * The Pimlico/bundler seam (`prepareUserOp`, `submitUserOp`, `executeSendCalls`), the EOA classifier
 * (`classifySender`), and the relay (`relayTxAndWaitPacket`) are `vi.mock`ed, so the tests exercise
 * validation, DTO mapping, signature-recovery, and orchestration offline. A real `Sodax` (configured
 * with gasless endpoints for BSC) backs every test; `buildDepositCalls` runs for real. A real viem
 * `privateKeyToAccount` plays the external signer, so `submit`'s recover-to-sender check is genuine.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, EvmSpokeOnlyChainKey, Hex, IGaslessCapableEvmWalletProvider } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { toGaslessApiErrorCode } from './errors.js';

const mocks = vi.hoisted(() => ({
  prepareUserOp: vi.fn(),
  submitUserOp: vi.fn(),
  executeSendCalls: vi.fn(),
  classifySender: vi.fn(),
  relayTxAndWaitPacket: vi.fn(),
}));

vi.mock('./internal/prepareUserOp.js', () => ({ prepareUserOp: mocks.prepareUserOp }));
vi.mock('./internal/submitUserOp.js', () => ({ submitUserOp: mocks.submitUserOp }));
vi.mock('./internal/sendCallsExecutor.js', () => ({ executeSendCalls: mocks.executeSendCalls }));
vi.mock('./internal/eoa.js', () => ({ classifySender: mocks.classifySender }));
vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return { ...actual, relayTxAndWaitPacket: mocks.relayTxAndWaitPacket };
});

const makeCapableWallet = (
  caps: unknown = { atomic: { status: 'supported' }, paymasterService: { supported: true } },
): IGaslessCapableEvmWalletProvider =>
  ({
    chainType: 'EVM',
    getCapabilities: vi.fn().mockResolvedValue(caps),
    sendCalls: vi.fn(),
    waitForCallsStatus: vi.fn(),
    getWalletAddress: vi.fn().mockResolvedValue(SIGNER.address),
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

// Deterministic test signers built without committing a 0x+64-hex private-key literal (secrets gate).
const SIGNER = privateKeyToAccount(`0x${'a1'.repeat(32)}` as Hex);
const OTHER = privateKeyToAccount(`0x${'b2'.repeat(32)}` as Hex);
const TOKEN = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' as Address;
const HUB_RECIPIENT = '0x1111111111111111111111111111111111111111' as Address;
const DATA = '0xdeadbeef' as Hex;
const USER_OP_HASH = `0x${'ab'.repeat(32)}` as Hex;
const SRC_TX = '0xaaaa000000000000000000000000000000000000000000000000000000000001';
const DST_TX = '0xbbbb000000000000000000000000000000000000000000000000000000000002';

const UNSIGNED_USER_OP = {
  sender: SIGNER.address as Address,
  nonce: 5n,
  callData: '0xcafe' as Hex,
  callGasLimit: 100000n,
  verificationGasLimit: 200000n,
  preVerificationGas: 50000n,
  maxFeePerGas: 1000n,
  maxPriorityFeePerGas: 900n,
  paymaster: '0x00000000000000000000000000000000000000aa' as Address,
  paymasterData: '0xbeef' as Hex,
};

const prepareRequest = (overrides: Record<string, unknown> = {}) => ({
  srcChainKey: BSC,
  srcAddress: SIGNER.address,
  token: TOKEN,
  amount: '1000000',
  to: HUB_RECIPIENT,
  data: DATA,
  ...overrides,
});

afterEach(() => {
  vi.clearAllMocks();
  mocks.classifySender.mockResolvedValue({ isEoa: true });
});

describe('GaslessService.getCapabilities', () => {
  it('is eligible for a configured chain + EOA sender', async () => {
    mocks.classifySender.mockResolvedValue({ isEoa: true });
    const result = await sodax.gasless.getCapabilities({ srcChainKey: BSC, srcAddress: SIGNER.address });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        configured: true,
        senderIsEoa: true,
        sponsorshipAvailable: true,
        eligible: true,
      });
    }
  });

  it('is NOT eligible when a bundler endpoint is missing (which prepare requires)', async () => {
    mocks.classifySender.mockResolvedValue({ isEoa: true });
    // paymaster-only config: isSupported is true, but prepare needs a bundler too.
    const paymasterOnly = new Sodax({
      gasless: { chains: { [BSC]: { paymasterUrl: PAYMASTER_URL, supports7702: true } } },
    });
    const result = await paymasterOnly.gasless.getCapabilities({ srcChainKey: BSC, srcAddress: SIGNER.address });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sponsorshipAvailable).toBe(true);
      expect(result.value.eligible).toBe(false);
      expect(result.value.reason).toMatch(/bundler/i);
    }
  });

  it('rejects a deployed smart-contract account (not an EOA)', async () => {
    mocks.classifySender.mockResolvedValue({ isEoa: false });
    const result = await sodax.gasless.getCapabilities({ srcChainKey: BSC, srcAddress: HUB_RECIPIENT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.senderIsEoa).toBe(false);
      expect(result.value.eligible).toBe(false);
      expect(result.value.reason).toMatch(/EOA/i);
    }
  });

  it('reports not-configured for an unconfigured chain without probing code', async () => {
    const result = await sodax.gasless.getCapabilities({ srcChainKey: ARBITRUM, srcAddress: SIGNER.address });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ configured: false, eligible: false });
    }
    expect(mocks.classifySender).not.toHaveBeenCalled();
  });
});

describe('GaslessService.prepare', () => {
  it('builds the [approve, transfer] batch and returns the JSON-safe sign-requests', async () => {
    mocks.classifySender.mockResolvedValue({ isEoa: true });
    mocks.prepareUserOp.mockResolvedValue({
      entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
      userOp: UNSIGNED_USER_OP,
      userOpHash: USER_OP_HASH,
      authorization: { chainId: 56, address: '0x000000000000000000000000000000000000e702' as Address, nonce: 7 },
    });

    const result = await sodax.gasless.prepare(prepareRequest());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.srcChainKey).toBe(BSC);
      expect(result.value.sender).toBe(SIGNER.address);
      expect(result.value.userOpHash).toBe(USER_OP_HASH);
      // bigints serialized to decimal strings on the wire.
      expect(result.value.userOp.nonce).toBe('5');
      expect(result.value.userOp.callGasLimit).toBe('100000');
      expect(result.value.authorization).toEqual({ chainId: 56, address: expect.any(String), nonce: 7 });
    }

    // prepareUserOp received the configured endpoints and a 2-call batch [approve(token), transfer(assetManager)].
    const assetManager = sodax.config.getChainConfig(BSC).addresses.assetManager;
    const call = mocks.prepareUserOp.mock.calls[0][0];
    expect(call.bundlerUrl).toBe(BUNDLER_URL);
    expect(call.paymasterUrl).toBe(PAYMASTER_URL);
    expect(call.calls).toHaveLength(2);
    expect(call.calls[0].to).toBe(TOKEN);
    expect(call.calls[1].to).toBe(assetManager);
  });

  it('rejects the native token, a zero/malformed amount, an unconfigured chain, and a non-EOA sender', async () => {
    const nativeToken = sodax.config.getChainConfig(BSC).nativeToken as Address;
    for (const [req, setup] of [
      [prepareRequest({ token: nativeToken }), () => mocks.classifySender.mockResolvedValue({ isEoa: true })],
      [prepareRequest({ amount: '0' }), () => mocks.classifySender.mockResolvedValue({ isEoa: true })],
      // a non-integer amount is a VALIDATION_FAILED, not a GAS_ESTIMATION_FAILED from a thrown BigInt()
      [prepareRequest({ amount: '1.5' }), () => mocks.classifySender.mockResolvedValue({ isEoa: true })],
      [prepareRequest({ srcChainKey: ARBITRUM }), () => mocks.classifySender.mockResolvedValue({ isEoa: true })],
      [prepareRequest(), () => mocks.classifySender.mockResolvedValue({ isEoa: false })],
    ] as const) {
      setup();
      const result = await sodax.gasless.prepare(req);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    }
    expect(mocks.prepareUserOp).not.toHaveBeenCalled();
  });

  it('rejects malformed HTTP-facing address/hex inputs as VALIDATION_FAILED (not GAS_ESTIMATION_FAILED)', async () => {
    // Malformed srcAddress/token/to/data must fail as a client 400 up front — before any viem/deposit
    // construction — otherwise the downstream throw would be wrapped as GAS_ESTIMATION_FAILED (→ 502).
    for (const req of [
      prepareRequest({ srcAddress: 'not-an-address' }),
      prepareRequest({ token: '0x1234' }), // too short to be an address
      prepareRequest({ to: 'nope' }),
      prepareRequest({ data: 'zzzz' }), // not hex
    ]) {
      const result = await sodax.gasless.prepare(req);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    }
    // Shape validation short-circuits before the bundler seam.
    expect(mocks.prepareUserOp).not.toHaveBeenCalled();
  });

  it('maps a configured-but-unsponsored chain (no paymaster) to SPONSORSHIP_UNAVAILABLE', async () => {
    mocks.classifySender.mockResolvedValue({ isEoa: true });
    // bundler-only config: `isSupported` is true, but there is no paymaster (and no Pimlico key to synthesize one).
    const bundlerOnly = new Sodax({
      gasless: { chains: { [BSC]: { bundlerUrl: BUNDLER_URL, supports7702: true } } },
    });
    const result = await bundlerOnly.gasless.prepare(prepareRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      // The chain IS configured — the accurate wire code is SPONSORSHIP_UNAVAILABLE, not CHAIN_NOT_CONFIGURED.
      expect(toGaslessApiErrorCode(result.error)).toBe('SPONSORSHIP_UNAVAILABLE');
    }
    expect(mocks.prepareUserOp).not.toHaveBeenCalled();
  });

  it('maps a configured chain missing only a bundler to SPONSORSHIP_UNAVAILABLE (not CHAIN_NOT_CONFIGURED)', async () => {
    mocks.classifySender.mockResolvedValue({ isEoa: true });
    // paymaster present, no bundler and no Pimlico key: `isSupported` passes, but `prepare` needs a bundler.
    const paymasterOnly = new Sodax({
      gasless: { chains: { [BSC]: { paymasterUrl: PAYMASTER_URL, supports7702: true } } },
    });
    const result = await paymasterOnly.gasless.prepare(prepareRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      // The chain IS configured — a missing bundler is unprovisioned infra, not an unknown chain.
      expect(toGaslessApiErrorCode(result.error)).toBe('SPONSORSHIP_UNAVAILABLE');
    }
    expect(mocks.prepareUserOp).not.toHaveBeenCalled();
  });

  it('treats a blank configured paymaster/bundler URL as absent and falls back to Pimlico', async () => {
    mocks.classifySender.mockResolvedValue({ isEoa: true });
    mocks.prepareUserOp.mockResolvedValue({
      entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
      userOp: UNSIGNED_USER_OP,
      userOpHash: USER_OP_HASH,
    });
    // Blank explicit URLs (e.g. an unset env var) + a Pimlico key: the blank must NOT be forwarded as an
    // endpoint; the Pimlico fallback fills both.
    const blankUrls = new Sodax({
      gasless: {
        pimlicoApiKey: 'pim_test',
        chains: { [BSC]: { paymasterUrl: '', bundlerUrl: '', supports7702: true } },
      },
    });
    const result = await blankUrls.gasless.prepare(prepareRequest());
    expect(result.ok).toBe(true);
    const call = mocks.prepareUserOp.mock.calls[0][0];
    expect(call.paymasterUrl).toContain('pimlico.io');
    expect(call.bundlerUrl).toContain('pimlico.io');
  });

  describe('per-request sponsorship override', () => {
    const POLICY_CHAIN = 'sp_chain_default';
    const sodaxWithPolicy = new Sodax({
      gasless: {
        chains: {
          [BSC]: {
            paymasterUrl: PAYMASTER_URL,
            bundlerUrl: BUNDLER_URL,
            supports7702: true,
            sponsorshipPolicyId: POLICY_CHAIN,
          },
        },
      },
    });

    const stubPrepareOk = () => {
      mocks.classifySender.mockResolvedValue({ isEoa: true });
      mocks.prepareUserOp.mockResolvedValue({
        entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
        userOp: UNSIGNED_USER_OP,
        userOpHash: USER_OP_HASH,
      });
    };
    const paymasterContextArg = () => mocks.prepareUserOp.mock.calls[0][0].paymasterContext;

    it('threads the per-chain sponsorshipPolicyId when no override is passed', async () => {
      stubPrepareOk();
      const result = await sodaxWithPolicy.gasless.prepare(prepareRequest());
      expect(result.ok).toBe(true);
      expect(paymasterContextArg()).toEqual({ sponsorshipPolicyId: POLICY_CHAIN });
    });

    it('lets a per-request sponsorshipPolicyId override the chain default', async () => {
      stubPrepareOk();
      const result = await sodaxWithPolicy.gasless.prepare(prepareRequest(), { sponsorshipPolicyId: 'sp_partner_a' });
      expect(result.ok).toBe(true);
      expect(paymasterContextArg()).toEqual({ sponsorshipPolicyId: 'sp_partner_a' });
    });

    it('lets a per-request paymasterContext win over both the policy id and the chain default', async () => {
      stubPrepareOk();
      const ctx = { sponsorshipPolicyId: 'sp_partner_a', mode: 'ERC20' };
      const result = await sodaxWithPolicy.gasless.prepare(prepareRequest(), {
        paymasterContext: ctx,
        sponsorshipPolicyId: 'sp_ignored',
      });
      expect(result.ok).toBe(true);
      expect(paymasterContextArg()).toEqual(ctx);
    });

    it('omits paymasterContext when neither chain nor request set one', async () => {
      stubPrepareOk();
      const result = await sodax.gasless.prepare(prepareRequest()); // base `sodax` config has no chain policy
      expect(result.ok).toBe(true);
      expect(paymasterContextArg()).toBeUndefined();
    });
  });
});

describe('GaslessService.submit', () => {
  const prepared = () => ({
    srcChainKey: BSC,
    chainId: 56,
    sender: SIGNER.address,
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    userOp: {
      sender: SIGNER.address,
      nonce: '5',
      callData: '0xcafe',
      callGasLimit: '100000',
      verificationGasLimit: '200000',
      preVerificationGas: '50000',
      maxFeePerGas: '1000',
      maxPriorityFeePerGas: '900',
      paymaster: '0x00000000000000000000000000000000000000aa',
      paymasterData: '0xbeef',
    },
    userOpHash: USER_OP_HASH,
  });

  it('verifies the signature recovers to the sender and broadcasts the signed op', async () => {
    mocks.submitUserOp.mockResolvedValue({ srcChainTxHash: SRC_TX, alreadyKnown: false });
    const userOp = await SIGNER.sign({ hash: USER_OP_HASH });

    const result = await sodax.gasless.submit({ prepared: prepared(), signatures: { userOp } });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.txHash).toBe(SRC_TX);
      expect(result.value.alreadyKnown).toBe(false);
    }
    const call = mocks.submitUserOp.mock.calls[0][0];
    expect(call.sender).toBe(SIGNER.address);
    expect(call.userOpSignature).toBe(userOp);
    expect(call.userOp.nonce).toBe(5n); // rehydrated from the DTO string
    expect(call.userOpHash).toBe(USER_OP_HASH); // the idempotency key passed to the executor
    expect(call.bundlerUrl).toBe(BUNDLER_URL);
  });

  it('threads alreadyKnown through from an idempotent re-broadcast', async () => {
    mocks.submitUserOp.mockResolvedValue({ srcChainTxHash: SRC_TX, alreadyKnown: true });
    const userOp = await SIGNER.sign({ hash: USER_OP_HASH });

    const result = await sodax.gasless.submit({ prepared: prepared(), signatures: { userOp } });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ txHash: SRC_TX, alreadyKnown: true });
  });

  it('rejects a signature that recovers to a different address (SIGNATURE_MISMATCH)', async () => {
    const userOp = await OTHER.sign({ hash: USER_OP_HASH });

    const result = await sodax.gasless.submit({ prepared: prepared(), signatures: { userOp } });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.context?.reason).toBe('SIGNATURE_MISMATCH');
    }
    expect(mocks.submitUserOp).not.toHaveBeenCalled();
  });

  it('classifies a malformed (unrecoverable) signature as VALIDATION_FAILED, not TX_SUBMIT_FAILED', async () => {
    const result = await sodax.gasless.submit({ prepared: prepared(), signatures: { userOp: '0x1234' } });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.context?.reason).toBe('SIGNATURE_MISMATCH');
    }
    expect(mocks.submitUserOp).not.toHaveBeenCalled();
  });

  it('requires an authorization signature iff prepare returned an authorization tuple', async () => {
    const userOp = await SIGNER.sign({ hash: USER_OP_HASH });
    const withAuth = { ...prepared(), authorization: { chainId: 56, address: OTHER.address, nonce: 7 } };

    // Missing the authorization signature → rejected.
    const missing = await sodax.gasless.submit({ prepared: withAuth, signatures: { userOp } });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.submitUserOp).not.toHaveBeenCalled();
  });

  it('accepts an authorization signature that recovers to the sender', async () => {
    mocks.submitUserOp.mockResolvedValue({ srcChainTxHash: SRC_TX });
    const authTuple = { chainId: 56, address: OTHER.address, nonce: 7 };
    const userOp = await SIGNER.sign({ hash: USER_OP_HASH });
    const signedAuth = await SIGNER.signAuthorization(authTuple);

    const result = await sodax.gasless.submit({
      prepared: { ...prepared(), authorization: authTuple },
      signatures: { userOp, authorization: { r: signedAuth.r, s: signedAuth.s, yParity: signedAuth.yParity ?? 0 } },
    });

    expect(result.ok).toBe(true);
    expect(mocks.submitUserOp).toHaveBeenCalledTimes(1);
  });

  it('rejects an authorization signed by a different key (SIGNATURE_MISMATCH)', async () => {
    const authTuple = { chainId: 56, address: OTHER.address, nonce: 7 };
    const userOp = await SIGNER.sign({ hash: USER_OP_HASH }); // valid userOp sig
    const wrongAuth = await OTHER.signAuthorization(authTuple); // authorization signed by the wrong key

    const result = await sodax.gasless.submit({
      prepared: { ...prepared(), authorization: authTuple },
      signatures: { userOp, authorization: { r: wrongAuth.r, s: wrongAuth.s, yParity: wrongAuth.yParity ?? 0 } },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.context?.reason).toBe('SIGNATURE_MISMATCH');
    }
    expect(mocks.submitUserOp).not.toHaveBeenCalled();
  });

  it('rejects a malformed prepared.userOp numeric field as VALIDATION_FAILED, not TX_SUBMIT_FAILED', async () => {
    const userOp = await SIGNER.sign({ hash: USER_OP_HASH });
    // A corrupted numeric field would throw in `BigInt()`; that must surface as a client validation error.
    const bad = { ...prepared(), userOp: { ...prepared().userOp, nonce: 'abc' } };

    const result = await sodax.gasless.submit({ prepared: bad, signatures: { userOp } });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(toGaslessApiErrorCode(result.error)).toBe('INVALID_REQUEST');
    }
    expect(mocks.submitUserOp).not.toHaveBeenCalled();
  });

  it('rejects a prepared.userOp.sender that diverges from prepared.sender', async () => {
    const userOp = await SIGNER.sign({ hash: USER_OP_HASH });
    const bad = { ...prepared(), userOp: { ...prepared().userOp, sender: OTHER.address } };

    const result = await sodax.gasless.submit({ prepared: bad, signatures: { userOp } });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.submitUserOp).not.toHaveBeenCalled();
  });
});

describe('GaslessService.sendCalls (Mode A)', () => {
  it('runs the sponsored batch through an external wallet and returns tx hash + relayData', async () => {
    mocks.executeSendCalls.mockResolvedValue({ srcChainTxHash: SRC_TX });
    const wallet = makeCapableWallet();

    const result = await sodax.gasless.sendCalls({
      srcChainKey: BSC,
      srcAddress: SIGNER.address,
      token: TOKEN,
      amount: 1_000_000n,
      to: HUB_RECIPIENT,
      data: DATA,
      walletProvider: wallet,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ srcChainTxHash: SRC_TX, relayData: { address: HUB_RECIPIENT, payload: DATA } });
    }
    const call = mocks.executeSendCalls.mock.calls[0][0];
    expect(call.wallet).toBe(wallet);
    expect(call.paymasterUrl).toBe(PAYMASTER_URL);
    expect(call.calls).toHaveLength(2);
  });

  it('rejects when srcAddress does not match the connected wallet', async () => {
    const wallet = makeCapableWallet();
    const result = await sodax.gasless.sendCalls({
      srcChainKey: BSC,
      srcAddress: HUB_RECIPIENT, // ≠ wallet address (SIGNER)
      token: TOKEN,
      amount: 1_000_000n,
      to: HUB_RECIPIENT,
      data: DATA,
      walletProvider: wallet,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.executeSendCalls).not.toHaveBeenCalled();
  });

  it('rejects a wallet lacking EIP-5792 atomic/paymaster support before touching it', async () => {
    const wallet = makeCapableWallet({ atomic: { status: 'unsupported' } });
    const result = await sodax.gasless.sendCalls({
      srcChainKey: BSC,
      srcAddress: SIGNER.address,
      token: TOKEN,
      amount: 1_000_000n,
      to: HUB_RECIPIENT,
      data: DATA,
      walletProvider: wallet,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.context?.reason).toBe('gasless-unsupported');
    }
    expect(mocks.executeSendCalls).not.toHaveBeenCalled();
  });

  it('rejects the native token and a zero amount (guards shared with prepare, on the Mode A path too)', async () => {
    const nativeToken = sodax.config.getChainConfig(BSC).nativeToken as Address;
    const wallet = makeCapableWallet();
    const base = {
      srcChainKey: BSC,
      srcAddress: SIGNER.address,
      to: HUB_RECIPIENT,
      data: DATA,
      walletProvider: wallet,
    } as const;

    const native = await sodax.gasless.sendCalls({ ...base, token: nativeToken, amount: 1_000_000n });
    expect(native.ok).toBe(false);
    if (!native.ok) expect(toGaslessApiErrorCode(native.error)).toBe('INVALID_TOKEN');

    const zero = await sodax.gasless.sendCalls({ ...base, token: TOKEN, amount: 0n });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error.code).toBe('VALIDATION_FAILED');

    expect(mocks.executeSendCalls).not.toHaveBeenCalled();
  });
});

describe('GaslessService.buildSendCalls (Mode A, server-side / no wallet)', () => {
  const batch = {
    srcChainKey: BSC,
    srcAddress: SIGNER.address,
    token: TOKEN,
    amount: 1_000_000n,
    to: HUB_RECIPIENT,
    data: DATA,
  } as const;

  it('returns the encoded [approve, transfer] batch + chainId + a client-safe (explicit) paymaster', async () => {
    const result = await sodax.gasless.buildSendCalls(batch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.calls).toHaveLength(2); // approve + transfer
      expect(result.value.chainId).toBe(56); // BSC (0x38)
      expect(result.value.paymaster?.url).toBe(PAYMASTER_URL); // explicit per-chain URL is client-safe
      expect(result.value.relayData).toEqual({ address: HUB_RECIPIENT, payload: DATA });
    }
    expect(mocks.executeSendCalls).not.toHaveBeenCalled(); // build-only — never touches a wallet
  });

  it('WITHHOLDS a Pimlico-key paymaster URL from the wire (only pimlicoApiKey configured)', async () => {
    const keyOnly = new Sodax({ gasless: { pimlicoApiKey: 'pk_test', chains: { [BSC]: { supports7702: true } } } });
    const result = await keyOnly.gasless.buildSendCalls(batch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.calls).toHaveLength(2); // batch still built
      expect(result.value.paymaster).toBeUndefined(); // the key-bearing URL is never exposed
    }
  });

  it('exposes a paymaster-proxy URL (client-safe) with the chain id appended', async () => {
    const proxied = new Sodax({
      gasless: { paymasterProxyUrl: 'https://proxy.example', chains: { [BSC]: { supports7702: true } } },
    });
    const result = await proxied.gasless.buildSendCalls(batch);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.paymaster?.url).toBe('https://proxy.example/56');
  });

  it('rejects the native token and a zero amount (guards shared with sendCalls)', async () => {
    const nativeToken = sodax.config.getChainConfig(BSC).nativeToken as Address;
    const native = await sodax.gasless.buildSendCalls({ ...batch, token: nativeToken });
    expect(native.ok).toBe(false);
    if (!native.ok) expect(toGaslessApiErrorCode(native.error)).toBe('INVALID_TOKEN');

    const zero = await sodax.gasless.buildSendCalls({ ...batch, amount: 0n });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GaslessService.relay', () => {
  it('verifies the spoke tx and relays to the hub', async () => {
    mocks.relayTxAndWaitPacket.mockResolvedValue({ ok: true, value: { dst_tx_hash: DST_TX } });

    const result = await sodax.gasless.relay({
      srcChainKey: BSC,
      srcChainTxHash: SRC_TX,
      relayData: { address: HUB_RECIPIENT, payload: DATA },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ srcChainTxHash: SRC_TX, dstChainTxHash: DST_TX });
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        srcTxHash: SRC_TX,
        data: { address: HUB_RECIPIENT, payload: DATA },
        chainKey: BSC,
      }),
    );
  });

  it('maps a relay failure to a gasless orchestration error', async () => {
    mocks.relayTxAndWaitPacket.mockResolvedValue({ ok: false, error: new Error('RELAY_TIMEOUT') });
    const result = await sodax.gasless.relay({
      srcChainKey: BSC,
      srcChainTxHash: SRC_TX,
      relayData: { address: HUB_RECIPIENT, payload: DATA },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.feature).toBe('gasless');
  });
});
