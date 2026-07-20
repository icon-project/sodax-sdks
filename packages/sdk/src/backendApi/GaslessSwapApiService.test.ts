/**
 * Unit tests for GaslessSwapApiService (the `sodax.api.gaslessSwap` HTTP client).
 *
 * The shared `makeRequest` transport is `vi.mock`ed, so the tests assert the SDK conventions on top:
 * every method POSTs the JSON-safe DTO to its `/gasless-swap/*` endpoint against ONE base URL, wraps
 * the result in `Result<T>` (never throws), validates the response shape, emits the canonical
 * `EXTERNAL_API_ERROR` (`feature: 'backend'`, `context.api: 'gasless-swap'`), and projects a wire
 * `GaslessSwapApiErrorCode` (incl. the swap-specific `INTENT_BUILD_FAILED`) from an HTTP error body.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateIntentParamsV2, GaslessPrepareResponse, IntentResponseV2, SodaxLogger } from '@sodax/types';

const mocks = vi.hoisted(() => ({ makeRequest: vi.fn() }));
vi.mock('./api-utils.js', () => ({ makeRequest: mocks.makeRequest }));

import { GaslessSwapApiService } from './GaslessSwapApiService.js';

const logger: SodaxLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
const service = new GaslessSwapApiService(
  { baseURL: 'https://gasless.example', timeout: 30000, headers: {} },
  logger,
);

const SENDER = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8';
const HUB = '0x2222222222222222222222222222222222222222';

const PARAMS: CreateIntentParamsV2 = {
  inputToken: TOKEN,
  outputToken: '0x3333333333333333333333333333333333333333',
  inputAmount: '1000000',
  minOutputAmount: '990000',
  deadline: '1750000000',
  allowPartialFill: false,
  srcChainKey: '0x38.bsc',
  dstChainKey: 'sonic',
  srcAddress: SENDER,
  dstAddress: SENDER,
};

const INTENT: IntentResponseV2 = {
  intentId: '1',
  creator: SENDER,
  inputToken: TOKEN,
  outputToken: '0x3333333333333333333333333333333333333333',
  inputAmount: '1000000',
  minOutputAmount: '990000',
  deadline: '1750000000',
  allowPartialFill: false,
  srcChain: '56',
  dstChain: '146',
  srcAddress: SENDER,
  dstAddress: SENDER,
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
};

const RELAY = { address: HUB, payload: '0xdead' };

const PREPARED: GaslessPrepareResponse = {
  srcChainKey: '0x38.bsc',
  chainId: 56,
  sender: SENDER,
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  userOp: {
    sender: SENDER,
    nonce: '5',
    callData: '0xcafe',
    callGasLimit: '100000',
    verificationGasLimit: '200000',
    preVerificationGas: '50000',
    maxFeePerGas: '1000',
    maxPriorityFeePerGas: '900',
  },
  userOpHash: `0x${'ab'.repeat(32)}`,
};

const CAPS = {
  srcChainKey: '0x38.bsc',
  srcAddress: SENDER,
  configured: true,
  senderIsEoa: true,
  sponsorshipAvailable: true,
  eligible: true,
};

afterEach(() => vi.clearAllMocks());

describe('GaslessSwapApiService', () => {
  it('getCapabilities POSTs to /gasless-swap/capabilities', async () => {
    mocks.makeRequest.mockResolvedValue(CAPS);
    const result = await service.getCapabilities({ srcChainKey: '0x38.bsc', srcAddress: SENDER });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(CAPS);
    const call = mocks.makeRequest.mock.calls[0][0];
    expect(call.endpoint).toBe('/gasless-swap/capabilities');
    expect(call.config.method).toBe('POST');
  });

  it('prepareSwap POSTs params to /gasless-swap/prepare and returns {prepared, intent, relayData}', async () => {
    mocks.makeRequest.mockResolvedValue({ prepared: PREPARED, intent: INTENT, relayData: RELAY });
    const result = await service.prepareSwap(PARAMS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prepared.userOpHash).toBe(PREPARED.userOpHash);
      expect(result.value.intent.intentId).toBe('1');
      expect(result.value.relayData).toEqual(RELAY);
    }
    expect(mocks.makeRequest.mock.calls[0][0].endpoint).toBe('/gasless-swap/prepare');
  });

  it('submitSwap POSTs to /gasless-swap/submit', async () => {
    mocks.makeRequest.mockResolvedValue({ txHash: '0xabc' });
    const result = await service.submitSwap({ prepared: PREPARED, signatures: { userOp: '0xsig' } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.txHash).toBe('0xabc');
    expect(mocks.makeRequest.mock.calls[0][0].endpoint).toBe('/gasless-swap/submit');
  });

  it('buildSwapCalls POSTs to /gasless-swap/build-calls and returns the encoded batch + capabilities', async () => {
    const calls = [
      { to: TOKEN, data: '0xapprove', value: '0' },
      { to: '0x4444444444444444444444444444444444444444', data: '0xtransfer', value: '0' },
    ];
    const capabilities = {
      chainId: 56,
      atomic: { status: 'required' },
      paymasterService: { url: 'https://proxy.example/56', context: { sponsorshipPolicyId: 'sp_1' } },
    };
    mocks.makeRequest.mockResolvedValue({ calls, capabilities, intent: INTENT, relayData: RELAY });
    const result = await service.buildSwapCalls(PARAMS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.calls).toEqual(calls);
      expect(result.value.capabilities).toEqual(capabilities);
    }
    expect(mocks.makeRequest.mock.calls[0][0].endpoint).toBe('/gasless-swap/build-calls');
  });

  it('buildSwapCalls accepts a response with no paymasterService (unsponsored / proxy not configured)', async () => {
    mocks.makeRequest.mockResolvedValue({
      calls: [{ to: TOKEN, data: '0xapprove', value: '0' }],
      capabilities: { chainId: 56, atomic: { status: 'required' } },
      intent: INTENT,
      relayData: RELAY,
    });
    const result = await service.buildSwapCalls(PARAMS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.capabilities.paymasterService).toBeUndefined();
  });

  it('completeSwap POSTs to /gasless-swap/complete and returns the submit ack', async () => {
    mocks.makeRequest.mockResolvedValue({ success: true, data: { status: 'inserted', message: 'Accepted' } });
    const result = await service.completeSwap({
      txHash: '0xsrc',
      srcChainKey: '0x38.bsc',
      walletAddress: SENDER,
      intent: INTENT,
      relayData: RELAY,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.data.status).toBe('inserted');
    expect(mocks.makeRequest.mock.calls[0][0].endpoint).toBe('/gasless-swap/complete');
  });

  it('getSwapCompletionStatus POSTs to /gasless-swap/completion-status and returns the terminal state', async () => {
    mocks.makeRequest.mockResolvedValue({
      success: true,
      data: {
        txHash: '0xsrc',
        srcChainKey: '0x38.bsc',
        status: 'solved',
        processingAttempts: 1,
        result: { dstIntentTxHash: '0xdst', intent_hash: '0xhash' },
      },
    });
    const result = await service.getSwapCompletionStatus({ txHash: '0xsrc', srcChainKey: '0x38.bsc' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.status).toBe('solved');
      expect(result.value.data.result?.dstIntentTxHash).toBe('0xdst');
    }
    expect(mocks.makeRequest.mock.calls[0][0].endpoint).toBe('/gasless-swap/completion-status');
  });

  it('surfaces an invalid response shape as EXTERNAL_API_ERROR (api: gasless-swap)', async () => {
    mocks.makeRequest.mockResolvedValue({ txHash: 123 }); // wrong type for submitSwap
    const result = await service.submitSwap({ prepared: PREPARED, signatures: { userOp: '0xsig' } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXTERNAL_API_ERROR');
      expect(result.error.context?.api).toBe('gasless-swap');
      expect(result.error.context?.reason).toBe('invalid_response_shape');
    }
  });

  it('projects a swap-specific wire code (INTENT_BUILD_FAILED) + status from an HTTP error body', async () => {
    mocks.makeRequest.mockRejectedValue(
      new Error('HTTP_REQUEST_FAILED', { cause: new Error('HTTP 400: {"code":"INTENT_BUILD_FAILED"}') }),
    );
    const result = await service.prepareSwap(PARAMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.context?.api).toBe('gasless-swap');
      expect(result.error.context?.code).toBe('INTENT_BUILD_FAILED');
      expect(result.error.context?.status).toBe(400);
    }
  });

  it('applies setHeaders and forwards the per-call override to makeRequest', async () => {
    mocks.makeRequest.mockResolvedValue(CAPS);
    const svc = new GaslessSwapApiService({ baseURL: 'https://gasless.example', timeout: 30000, headers: {} }, logger);
    svc.setHeaders({ Authorization: 'Bearer token' });
    await svc.getCapabilities(
      { srcChainKey: '0x38.bsc', srcAddress: SENDER },
      { baseURL: 'https://override.example', headers: { 'X-Trace': '1' } },
    );
    const call = mocks.makeRequest.mock.calls[0][0];
    expect(call.config.baseURL).toBe('https://gasless.example');
    expect(call.config.headers.Authorization).toBe('Bearer token');
    expect(call.overrideConfig).toEqual({ baseURL: 'https://override.example', headers: { 'X-Trace': '1' } });
  });
});
