/**
 * Unit tests for GaslessApiService (the `sodax.api.gasless` HTTP client).
 *
 * The shared `makeRequest` transport is `vi.mock`ed, so the tests assert the SDK conventions on top:
 * `Result<T>` wrapping (never throws), response-shape validation, the canonical
 * `EXTERNAL_API_ERROR` (`feature: 'backend'`, `context.api: 'gasless'`), and projection of a wire
 * `GaslessApiErrorCode` from an HTTP error body into `context.code`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GaslessPrepareResponse, SodaxLogger } from '@sodax/types';

const mocks = vi.hoisted(() => ({ makeRequest: vi.fn() }));
vi.mock('./api-utils.js', () => ({ makeRequest: mocks.makeRequest }));

import { GaslessApiService } from './GaslessApiService.js';

const logger: SodaxLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
const service = new GaslessApiService({ baseURL: 'https://gasless.example', timeout: 30000, headers: {} }, logger);

const CAPS = {
  srcChainKey: '0x38.bsc',
  srcAddress: '0x1111111111111111111111111111111111111111',
  configured: true,
  senderIsEoa: true,
  sponsorshipAvailable: true,
  eligible: true,
};

const PREPARED: GaslessPrepareResponse = {
  srcChainKey: '0x38.bsc',
  chainId: 56,
  sender: '0x1111111111111111111111111111111111111111',
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  userOp: {
    sender: '0x1111111111111111111111111111111111111111',
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

afterEach(() => vi.clearAllMocks());

describe('GaslessApiService', () => {
  it('getCapabilities POSTs to /gasless/capabilities and returns the validated body', async () => {
    mocks.makeRequest.mockResolvedValue(CAPS);
    const result = await service.getCapabilities({ srcChainKey: '0x38.bsc', srcAddress: CAPS.srcAddress });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(CAPS);
    const call = mocks.makeRequest.mock.calls[0][0];
    expect(call.endpoint).toBe('/gasless/capabilities');
    expect(call.config.method).toBe('POST');
  });

  it('prepare and submit round-trip their responses', async () => {
    mocks.makeRequest.mockResolvedValueOnce(PREPARED);
    const prep = await service.prepare({
      srcChainKey: '0x38.bsc',
      srcAddress: PREPARED.sender,
      token: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
      amount: '1000000',
      to: '0x2222222222222222222222222222222222222222',
      data: '0xdead',
    });
    expect(prep.ok).toBe(true);
    if (prep.ok) expect(prep.value.userOpHash).toBe(PREPARED.userOpHash);

    mocks.makeRequest.mockResolvedValueOnce({ txHash: '0xabc' });
    const sub = await service.submit({ prepared: PREPARED, signatures: { userOp: '0xsig' } });
    expect(sub.ok).toBe(true);
    if (sub.ok) expect(sub.value.txHash).toBe('0xabc');
  });

  it('accepts explicit null for optional fields, normalizing them to undefined', async () => {
    mocks.makeRequest.mockResolvedValueOnce({ ...CAPS, reason: null });
    const caps = await service.getCapabilities({ srcChainKey: '0x38.bsc', srcAddress: CAPS.srcAddress });
    expect(caps.ok).toBe(true);
    if (caps.ok) expect(caps.value.reason).toBeUndefined();

    mocks.makeRequest.mockResolvedValueOnce({
      ...PREPARED,
      authorization: null,
      userOp: { ...PREPARED.userOp, paymaster: null },
    });
    const prep = await service.prepare({
      srcChainKey: '0x38.bsc',
      srcAddress: PREPARED.sender,
      token: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
      amount: '1000000',
      to: '0x2222222222222222222222222222222222222222',
      data: '0xdead',
    });
    expect(prep.ok).toBe(true);
    if (prep.ok) {
      expect(prep.value.authorization).toBeUndefined();
      expect(prep.value.userOp.paymaster).toBeUndefined();
    }
  });

  it('surfaces an invalid response shape as EXTERNAL_API_ERROR', async () => {
    mocks.makeRequest.mockResolvedValue({ txHash: 123 }); // wrong type
    const result = await service.submit({ prepared: PREPARED, signatures: { userOp: '0xsig' } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXTERNAL_API_ERROR');
      expect(result.error.context?.api).toBe('gasless');
      expect(result.error.context?.reason).toBe('invalid_response_shape');
    }
  });

  it('projects a wire GaslessApiErrorCode + status from an HTTP error body', async () => {
    mocks.makeRequest.mockRejectedValue(
      new Error('HTTP_REQUEST_FAILED', { cause: new Error('HTTP 400: {"code":"SENDER_NOT_EOA"}') }),
    );
    const result = await service.getCapabilities({ srcChainKey: '0x38.bsc', srcAddress: CAPS.srcAddress });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXTERNAL_API_ERROR');
      expect(result.error.context?.api).toBe('gasless');
      expect(result.error.context?.code).toBe('SENDER_NOT_EOA');
      expect(result.error.context?.status).toBe(400);
    }
  });

  it('applies setHeaders to the service config and forwards the per-call override to makeRequest', async () => {
    mocks.makeRequest.mockResolvedValue(CAPS);
    // Fresh instance so the mutating setHeaders call cannot leak onto the shared module-level service.
    const svc = new GaslessApiService({ baseURL: 'https://gasless.example', timeout: 30000, headers: {} }, logger);
    svc.setHeaders({ Authorization: 'Bearer token' });
    await svc.getCapabilities(
      { srcChainKey: '0x38.bsc', srcAddress: CAPS.srcAddress },
      { baseURL: 'https://override.example', headers: { 'X-Trace': '1' } },
    );
    const call = mocks.makeRequest.mock.calls[0][0];
    // setHeaders lands on the service config; the per-call override is delegated to makeRequest
    // (which folds it over the config — see api-utils tests), not pre-merged here.
    expect(call.config.baseURL).toBe('https://gasless.example');
    expect(call.config.headers.Authorization).toBe('Bearer token');
    expect(call.overrideConfig).toEqual({ baseURL: 'https://override.example', headers: { 'X-Trace': '1' } });
  });
});
