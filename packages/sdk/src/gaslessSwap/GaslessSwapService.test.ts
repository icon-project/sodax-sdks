/**
 * Unit tests for GaslessSwapService (the in-process `sodax.gaslessSwap` brain).
 *
 * The brain composes SwapService (`createIntent`, `postExecution`) + GaslessService
 * (`getCapabilities`/`prepare`/`submit`/`relay`); both are injected as plain stubs (cast to the service
 * types at the constructor boundary), so the tests exercise the brain's own logic offline: V2→domain
 * param conversion, the domain `Intent`→all-string `IntentResponseV2` projection (no bigint leak), the
 * Mode-A/Mode-B assembly, and the synchronous completion state machine (relay + solver-notify → stored
 * terminal state, idempotent on `(txHash, srcChainKey)`).
 */

import { describe, expect, it, vi } from 'vitest';
import type { CreateIntentParamsV2, IntentResponseV2 } from '@sodax/types';
import { SodaxError } from '../errors/SodaxError.js';
import type { GaslessService } from '../gasless/GaslessService.js';
import type { SwapService } from '../swap/SwapService.js';
import { GaslessSwapService } from './GaslessSwapService.js';

const SENDER = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8';
const OUT = '0x3333333333333333333333333333333333333333';
const HUB = '0x2222222222222222222222222222222222222222';
const ZERO = '0x0000000000000000000000000000000000000000';

const PARAMS: CreateIntentParamsV2 = {
  inputToken: TOKEN,
  outputToken: OUT,
  inputAmount: '1000000',
  minOutputAmount: '990000',
  deadline: '1750000000',
  allowPartialFill: false,
  srcChainKey: '0x38.bsc',
  dstChainKey: 'sonic',
  srcAddress: SENDER,
  dstAddress: SENDER,
};

// Domain `Intent & FeeAmount` (bigint numerics + the SDK-only `feeAmount` that projection must strip).
const DOMAIN_INTENT = {
  intentId: 1n,
  creator: SENDER,
  inputToken: TOKEN,
  outputToken: OUT,
  inputAmount: 1_000_000n,
  minOutputAmount: 990_000n,
  deadline: 1_750_000_000n,
  allowPartialFill: false,
  srcChain: 56n,
  dstChain: 146n,
  srcAddress: SENDER,
  dstAddress: SENDER,
  solver: ZERO,
  data: '0x',
  feeAmount: 500n,
};

const RELAY = { address: HUB, payload: '0xdead' };
const CREATE_INTENT_OK = { ok: true, value: { tx: {}, intent: DOMAIN_INTENT, relayData: RELAY } };

const PREPARED = { srcChainKey: '0x38.bsc', chainId: 56, sender: SENDER, entryPoint: ZERO, userOp: {}, userOpHash: '0xhash' };

const WIRE_INTENT: IntentResponseV2 = {
  intentId: '1',
  creator: SENDER,
  inputToken: TOKEN,
  outputToken: OUT,
  inputAmount: '1000000',
  minOutputAmount: '990000',
  deadline: '1750000000',
  allowPartialFill: false,
  srcChain: '56',
  dstChain: '146',
  srcAddress: SENDER,
  dstAddress: SENDER,
  solver: ZERO,
  data: '0x',
};

const ASSET_MANAGER = '0x4444444444444444444444444444444444444444';

// Domain result of gasless.buildSendCalls (bigint `value`; client-safe paymaster present).
const BUILD_SEND_CALLS_OK = {
  ok: true,
  value: {
    calls: [
      { to: TOKEN, data: '0xapprove', value: 0n },
      { to: ASSET_MANAGER, data: '0xtransfer', value: 0n },
    ],
    chainId: 56,
    paymaster: { url: 'https://proxy.example/56', context: { sponsorshipPolicyId: 'sp_1' } },
    relayData: RELAY,
  },
};

function makeService() {
  const swaps = { createIntent: vi.fn(), postExecution: vi.fn() };
  const gasless = { getCapabilities: vi.fn(), prepare: vi.fn(), submit: vi.fn(), relay: vi.fn(), buildSendCalls: vi.fn() };
  const service = new GaslessSwapService({
    swaps: swaps as unknown as SwapService,
    gasless: gasless as unknown as GaslessService,
  });
  return { service, swaps, gasless };
}

describe('GaslessSwapService (brain)', () => {
  it('getCapabilities delegates to the gasless brain', async () => {
    const { service, gasless } = makeService();
    const caps = { srcChainKey: '0x38.bsc', srcAddress: SENDER, configured: true, senderIsEoa: true, sponsorshipAvailable: true, eligible: true };
    gasless.getCapabilities.mockResolvedValue({ ok: true, value: caps });
    const result = await service.getCapabilities({ srcChainKey: '0x38.bsc', srcAddress: SENDER });
    expect(result).toEqual({ ok: true, value: caps });
    expect(gasless.getCapabilities).toHaveBeenCalledWith({ srcChainKey: '0x38.bsc', srcAddress: SENDER });
  });

  it('prepareSwap: builds a raw intent, projects an all-string intent, and prepares the UserOp', async () => {
    const { service, swaps, gasless } = makeService();
    swaps.createIntent.mockResolvedValue(CREATE_INTENT_OK);
    gasless.prepare.mockResolvedValue({ ok: true, value: PREPARED });

    const result = await service.prepareSwap(PARAMS);

    // createIntent is invoked raw with the V2 amounts converted to bigint.
    const createArg = swaps.createIntent.mock.calls[0][0];
    expect(createArg.raw).toBe(true);
    expect(createArg.params.inputAmount).toBe(1_000_000n);
    expect(createArg.params.deadline).toBe(1_750_000_000n);

    // prepare is fed the intent's relayData as the hub to+data.
    expect(gasless.prepare).toHaveBeenCalledWith({
      srcChainKey: '0x38.bsc',
      srcAddress: SENDER,
      token: TOKEN,
      amount: '1000000',
      to: HUB,
      data: '0xdead',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prepared).toEqual(PREPARED);
      expect(result.value.intent).toEqual(WIRE_INTENT);
      expect(result.value.relayData).toEqual(RELAY);
    }
  });

  it('prepareSwap: the projected intent is JSON-safe (no bigint, no feeAmount)', async () => {
    const { service, swaps, gasless } = makeService();
    swaps.createIntent.mockResolvedValue(CREATE_INTENT_OK);
    gasless.prepare.mockResolvedValue({ ok: true, value: PREPARED });

    const result = await service.prepareSwap(PARAMS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { intent } = result.value;
      for (const key of ['intentId', 'inputAmount', 'minOutputAmount', 'deadline', 'srcChain', 'dstChain'] as const) {
        expect(typeof intent[key]).toBe('string');
      }
      expect('feeAmount' in intent).toBe(false);
      expect(() => JSON.stringify(intent)).not.toThrow(); // a leaked bigint would throw
    }
  });

  it('prepareSwap: propagates a createIntent failure without preparing', async () => {
    const { service, swaps, gasless } = makeService();
    const error = new Error('intent build failed');
    swaps.createIntent.mockResolvedValue({ ok: false, error });
    const result = await service.prepareSwap(PARAMS);
    expect(result).toEqual({ ok: false, error });
    expect(gasless.prepare).not.toHaveBeenCalled();
  });

  it('prepareSwap: propagates a prepare failure', async () => {
    const { service, swaps, gasless } = makeService();
    swaps.createIntent.mockResolvedValue(CREATE_INTENT_OK);
    const error = new Error('sponsorship unavailable');
    gasless.prepare.mockResolvedValue({ ok: false, error });
    const result = await service.prepareSwap(PARAMS);
    expect(result).toEqual({ ok: false, error });
  });

  it('buildSwapCalls: returns the encoded EIP-5792 batch + capabilities (value stringified, paymaster present)', async () => {
    const { service, swaps, gasless } = makeService();
    swaps.createIntent.mockResolvedValue(CREATE_INTENT_OK);
    gasless.buildSendCalls.mockResolvedValue(BUILD_SEND_CALLS_OK);

    const result = await service.buildSwapCalls(PARAMS);

    // The intent's relayData is fed as the hub to+data, and the V2 string amount is converted to bigint.
    expect(gasless.buildSendCalls).toHaveBeenCalledWith({
      srcChainKey: '0x38.bsc',
      srcAddress: SENDER,
      token: TOKEN,
      amount: 1_000_000n,
      to: HUB,
      data: '0xdead',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Domain bigint `value` is projected to a decimal string on the wire.
      expect(result.value.calls).toEqual([
        { to: TOKEN, data: '0xapprove', value: '0' },
        { to: ASSET_MANAGER, data: '0xtransfer', value: '0' },
      ]);
      expect(result.value.capabilities).toEqual({
        chainId: 56,
        atomic: { status: 'required' },
        paymasterService: { url: 'https://proxy.example/56', context: { sponsorshipPolicyId: 'sp_1' } },
      });
      expect(result.value.intent).toEqual(WIRE_INTENT);
      expect(result.value.relayData).toEqual(RELAY);
      expect(() => JSON.stringify(result.value)).not.toThrow(); // no bigint leak
    }
  });

  it('buildSwapCalls: omits paymasterService when the brain returns no client-safe paymaster', async () => {
    const { service, swaps, gasless } = makeService();
    swaps.createIntent.mockResolvedValue(CREATE_INTENT_OK);
    gasless.buildSendCalls.mockResolvedValue({ ok: true, value: { calls: [], chainId: 56, relayData: RELAY } });

    const result = await service.buildSwapCalls(PARAMS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.capabilities).toEqual({ chainId: 56, atomic: { status: 'required' } });
      expect(result.value.capabilities.paymasterService).toBeUndefined();
    }
  });

  it('buildSwapCalls: propagates a createIntent failure without building calls', async () => {
    const { service, swaps, gasless } = makeService();
    const error = new Error('intent build failed');
    swaps.createIntent.mockResolvedValue({ ok: false, error });
    const result = await service.buildSwapCalls(PARAMS);
    expect(result).toEqual({ ok: false, error });
    expect(gasless.buildSendCalls).not.toHaveBeenCalled();
  });

  it('buildSwapCalls: propagates a buildSendCalls failure', async () => {
    const { service, swaps, gasless } = makeService();
    swaps.createIntent.mockResolvedValue(CREATE_INTENT_OK);
    const error = new Error('chain not gasless-configured');
    gasless.buildSendCalls.mockResolvedValue({ ok: false, error });
    const result = await service.buildSwapCalls(PARAMS);
    expect(result).toEqual({ ok: false, error });
  });

  it('submitSwap delegates to the gasless brain', async () => {
    const { service, gasless } = makeService();
    gasless.submit.mockResolvedValue({ ok: true, value: { txHash: '0xabc' } });
    const body = { prepared: PREPARED, signatures: { userOp: '0xsig' } } as never;
    const result = await service.submitSwap(body);
    expect(result).toEqual({ ok: true, value: { txHash: '0xabc' } });
    expect(gasless.submit).toHaveBeenCalledWith(body);
  });

  it('completeSwap: relay + solver-notify → stored terminal solved; idempotent on replay', async () => {
    const { service, swaps, gasless } = makeService();
    gasless.relay.mockResolvedValue({ ok: true, value: { srcChainTxHash: '0xsrc', dstChainTxHash: '0xdst' } });
    swaps.postExecution.mockResolvedValue({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });

    const body = { txHash: '0xsrc', srcChainKey: '0x38.bsc', walletAddress: SENDER, intent: WIRE_INTENT, relayData: RELAY };
    const first = await service.completeSwap(body);
    expect(first.ok && first.value.data.status).toBe('inserted');
    expect(gasless.relay).toHaveBeenCalledWith({
      srcChainKey: '0x38.bsc',
      srcChainTxHash: '0xsrc',
      relayData: { address: HUB, payload: '0xdead' },
    });
    expect(swaps.postExecution).toHaveBeenCalledWith({ intent_tx_hash: '0xdst' });

    const status = await service.getSwapCompletionStatus({ txHash: '0xsrc', srcChainKey: '0x38.bsc' });
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.value.success).toBe(true);
      expect(status.value.data.status).toBe('solved');
      expect(status.value.data.result).toEqual({ dstIntentTxHash: '0xdst', intent_hash: '0xhash' });
    }

    // Replay is idempotent: no second relay, and the ack flips to duplicate.
    const second = await service.completeSwap(body);
    expect(second.ok && second.value.data.status).toBe('duplicate');
    expect(gasless.relay).toHaveBeenCalledTimes(1);
  });

  it('completeSwap: a relay failure is stored as failed at the relaying step', async () => {
    const { service, swaps, gasless } = makeService();
    gasless.relay.mockResolvedValue({ ok: false, error: new Error('relay timed out') });

    await service.completeSwap({ txHash: '0xsrc', srcChainKey: '0x38.bsc', walletAddress: SENDER, intent: WIRE_INTENT, relayData: RELAY });
    expect(swaps.postExecution).not.toHaveBeenCalled();

    const status = await service.getSwapCompletionStatus({ txHash: '0xsrc', srcChainKey: '0x38.bsc' });
    if (status.ok) {
      expect(status.value.data.status).toBe('failed');
      expect(status.value.data.failedAtStep).toBe('relaying');
      expect(status.value.data.failureReason).toContain('relay timed out');
    }
  });

  it('completeSwap: a postExecution failure is stored as failed at the posting_execution step', async () => {
    const { service, swaps, gasless } = makeService();
    gasless.relay.mockResolvedValue({ ok: true, value: { srcChainTxHash: '0xsrc', dstChainTxHash: '0xdst' } });
    swaps.postExecution.mockResolvedValue({ ok: false, error: new Error('solver rejected') });

    await service.completeSwap({ txHash: '0xsrc', srcChainKey: '0x38.bsc', walletAddress: SENDER, intent: WIRE_INTENT, relayData: RELAY });

    const status = await service.getSwapCompletionStatus({ txHash: '0xsrc', srcChainKey: '0x38.bsc' });
    if (status.ok) {
      expect(status.value.data.status).toBe('failed');
      expect(status.value.data.failedAtStep).toBe('posting_execution');
      expect(status.value.data.result).toEqual({ dstIntentTxHash: '0xdst' });
    }
  });

  it('getSwapCompletionStatus: unknown (txHash, srcChainKey) → success:false, pending', async () => {
    const { service } = makeService();
    const status = await service.getSwapCompletionStatus({ txHash: '0xunknown', srcChainKey: '0x38.bsc' });
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.value.success).toBe(false);
      expect(status.value.data.status).toBe('pending');
      expect(status.value.data.processingAttempts).toBe(0);
    }
  });

  // ── never-throw contract on the HTTP-facing seam (malformed wire input → Result, not a rejected promise) ──

  it('prepareSwap: a malformed amount string returns VALIDATION_FAILED (never throws), without building the intent', async () => {
    const { service, swaps } = makeService();
    const result = await service.prepareSwap({ ...PARAMS, inputAmount: '1.5' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      expect((result.error as SodaxError).code).toBe('VALIDATION_FAILED');
      expect((result.error as SodaxError).context?.field).toBe('inputAmount');
    }
    expect(swaps.createIntent).not.toHaveBeenCalled(); // validated before the unguarded BigInt / createIntent
  });

  it('buildSwapCalls: a malformed amount string returns VALIDATION_FAILED (never throws)', async () => {
    const { service, swaps } = makeService();
    const result = await service.buildSwapCalls({ ...PARAMS, inputAmount: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as SodaxError).code).toBe('VALIDATION_FAILED');
    expect(swaps.createIntent).not.toHaveBeenCalled();
  });

  it('completeSwap: a missing relayData returns VALIDATION_FAILED (never throws), without relaying', async () => {
    const { service, gasless } = makeService();
    const result = await service.completeSwap({
      txHash: '0xsrc',
      srcChainKey: '0x38.bsc',
      walletAddress: SENDER,
      intent: WIRE_INTENT,
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as SodaxError).code).toBe('VALIDATION_FAILED');
      expect((result.error as SodaxError).context?.field).toBe('relayData');
    }
    expect(gasless.relay).not.toHaveBeenCalled();
  });

  it('completeSwap: concurrent same-key calls dedup — relay fires once, one inserted + one duplicate', async () => {
    const { service, swaps, gasless } = makeService();
    let resolveRelay: (value: unknown) => void = () => {};
    gasless.relay.mockReturnValue(
      new Promise(resolve => {
        resolveRelay = resolve;
      }),
    );
    swaps.postExecution.mockResolvedValue({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });

    const body = { txHash: '0xsrc', srcChainKey: '0x38.bsc', walletAddress: SENDER, intent: WIRE_INTENT, relayData: RELAY };
    const p1 = service.completeSwap(body);
    const p2 = service.completeSwap(body); // starts while p1 is suspended at the relay await
    resolveRelay({ ok: true, value: { srcChainTxHash: '0xsrc', dstChainTxHash: '0xdst' } });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(gasless.relay).toHaveBeenCalledTimes(1); // the second call deduped before relaying
    const statuses = [r1, r2].map(r => (r.ok ? r.value.data.status : 'error')).sort();
    expect(statuses).toEqual(['duplicate', 'inserted']);
  });
});
