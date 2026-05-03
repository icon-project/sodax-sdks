/**
 * Tests for the IntentRelayApiService — the HTTP relay client used to submit
 * cross-chain intents and poll for their on-chain delivery.
 *
 * Mirrors the SonicSpokeService.test.ts / BackendApiService.test.ts pattern:
 *   1. `global.fetch` is stubbed once per file via `vi.stubGlobal`. Each `it`
 *      configures its own response with `mockFetch.mockResolvedValueOnce(...)`
 *      / `mockRejectedValueOnce(...)`. The `retry` helper from `shared-utils`
 *      is exercised through real code — fetch is the boundary.
 *   2. `describe(function name)` per exported function; one `it` per branch.
 *      Branchy functions (`waitUntilIntentExecuted`, `relayTxAndWaitPacket`)
 *      get nested `happy paths` / `rejects on invalid inputs` / `error
 *      propagation` subgroups.
 *   3. The polling loop in `waitUntilIntentExecuted` uses `vi.useFakeTimers()`
 *      so the 2s `setTimeout` between polls and the wall-clock `Date.now()`
 *      timeout check fire instantly. Tests that exercise the loop drive it
 *      with `vi.advanceTimersByTimeAsync(...)`.
 *   4. The static `RelayChainIdMap` (BSC_MAINNET → 4n) is referenced through
 *      the real `getIntentRelayChainId` so a mutation in `relayTxAndWaitPacket`
 *      that drops the `.toString()` or swaps the chain key surfaces here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RELAY_TX_TIMEOUT, type Hex, type HttpUrl } from '@sodax/types';
// `@sodax/types` is consumed from `dist/` in vitest; the generated dist entry is
// stale for some exports. Pull `ChainKeys` from source — same workaround the
// SonicSpokeService and BackendApiService tests use.
import { ChainKeys } from '../../../../../types/src/chains/chain-keys.js';
import {
  getPacket,
  getTransactionPackets,
  type IntentRelayRequest,
  type GetPacketResponse,
  type GetTransactionPacketsResponse,
  type PacketData,
  type RelayExtraData,
  relayTxAndWaitPacket,
  submitTransaction,
  type SubmitTxResponse,
  waitUntilIntentExecuted,
} from './IntentRelayApiService.js';

// --- fetch stub -----------------------------------------------------------
//
// `postRequest` wraps `fetch` in `retry(...)`. For successful responses the
// retry is a single attempt, so a one-shot `mockResolvedValueOnce` is enough.
// Tests that need to exercise retry exhaustion or polling iterations switch
// to fake timers and advance through the 2s back-off explicitly.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// --- fixtures -------------------------------------------------------------

const API_URL = 'https://relay.example.com/v1' as HttpUrl;
const SPOKE_TX_HASH = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const CHAIN_ID = '146'; // arbitrary; the service treats this as an opaque string
const CONN_SN = '42';

// `RelayAndWaitParams.data` is statically typed as required `RelayExtraData`,
// but `relayTxAndWaitPacket`'s invariant only requires it for Solana/Bitcoin
// source chains and the EVM branch never reads it. Tests for non-Solana/Bitcoin
// chains pass `undefined` and rely on this cast — same intent-defeating mock
// pattern the rest of the SDK test suite uses for misaligned param types.
const NO_DATA = undefined as unknown as RelayExtraData;

// Build a `fetch` response object that matches the `Response.json()` shape used
// by `postRequest`. Only the `.json()` method is read by the service.
const jsonResponse = <T>(body: T) => ({ json: vi.fn().mockResolvedValue(body) });

const buildPacket = (overrides: Partial<PacketData> = {}): PacketData => ({
  src_chain_id: 4,
  src_tx_hash: SPOKE_TX_HASH,
  src_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  status: 'executed',
  dst_chain_id: 146,
  conn_sn: 1,
  dst_address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  dst_tx_hash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  signatures: ['sig1', 'sig2'],
  payload: '0xpayload',
  ...overrides,
});

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// =========================================================================
// submitTransaction — POST + invariants on chain_id / tx_hash
// =========================================================================

describe('submitTransaction', () => {
  const baseParams = { chain_id: CHAIN_ID, tx_hash: SPOKE_TX_HASH };

  describe('happy paths', () => {
    it('POSTs JSON-stringified payload to apiUrl and returns ok:true wrapping the parsed body', async () => {
      const responseBody: SubmitTxResponse = { success: true, message: 'Transaction submitted' };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const payload: IntentRelayRequest<'submit'> = { action: 'submit', params: baseParams };
      const result = await submitTransaction(payload, API_URL);

      expect(result).toEqual({ ok: true, value: responseBody });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    });

    it('wraps a relayer-side failure (success:false) into ok:false SUBMIT_TX_FAILED with cause', async () => {
      // The HTTP request itself succeeded (200 OK) but the relayer rejected the
      // submission. The service inspects `success` and surfaces a SUBMIT_TX_FAILED
      // error whose `.cause` carries the relayer's message.
      const responseBody: SubmitTxResponse = {
        success: false,
        message: 'Invalid input parameters. must contain source_chain_id and tx_hash',
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await submitTransaction({ action: 'submit', params: baseParams }, API_URL);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('SUBMIT_TX_FAILED');
      expect(((result.error as Error).cause as Error).message).toBe(responseBody.message);
    });

    it('serializes the optional `data` field into the POST body when provided', async () => {
      // Used by Solana's split-tx flow — the on-chain tx carries only a hash,
      // and the full instruction blob is shipped off-chain via this `data` field.
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, message: 'ok' }));

      const data = { address: '0xhub' as Hex, payload: '0xpayload' as Hex };
      const payload: IntentRelayRequest<'submit'> = {
        action: 'submit',
        params: { ...baseParams, data },
      };

      await submitTransaction(payload, API_URL);

      const body = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
      expect(body.params.data).toEqual(data);
    });
  });

  describe('rejects on invalid inputs', () => {
    it('throws when chain_id is empty (invariant)', async () => {
      await expect(
        submitTransaction({ action: 'submit', params: { chain_id: '', tx_hash: SPOKE_TX_HASH } }, API_URL),
      ).rejects.toThrow('Invalid input parameters. source_chain_id empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when tx_hash is empty (invariant)', async () => {
      await expect(
        submitTransaction({ action: 'submit', params: { chain_id: CHAIN_ID, tx_hash: '' } }, API_URL),
      ).rejects.toThrow('Invalid input parameters. tx_hash empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

// =========================================================================
// getTransactionPackets — POST + invariants on chain_id / tx_hash
// =========================================================================

describe('getTransactionPackets', () => {
  const baseParams = { chain_id: CHAIN_ID, tx_hash: SPOKE_TX_HASH };

  describe('happy paths', () => {
    it('POSTs and returns ok:true wrapping the parsed packets array', async () => {
      const responseBody: GetTransactionPacketsResponse = {
        success: true,
        data: [buildPacket()],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const payload: IntentRelayRequest<'get_transaction_packets'> = {
        action: 'get_transaction_packets',
        params: baseParams,
      };
      const result = await getTransactionPackets(payload, API_URL);

      expect(result).toEqual({ ok: true, value: responseBody });
      expect(mockFetch).toHaveBeenCalledWith(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    });

    it('returns ok:true wrapping success:true with an empty data array (no packets yet)', async () => {
      // The relayer returns `{ success: true, data: [] }` while the tx is still
      // pending. The service must pass this through verbatim — `waitUntilIntentExecuted`
      // depends on the exact shape to drive its polling loop.
      const responseBody: GetTransactionPacketsResponse = { success: true, data: [] };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await getTransactionPackets({ action: 'get_transaction_packets', params: baseParams }, API_URL);

      expect(result).toEqual({ ok: true, value: responseBody });
    });
  });

  describe('rejects on invalid inputs', () => {
    it('throws when chain_id is empty (invariant)', async () => {
      await expect(
        getTransactionPackets(
          { action: 'get_transaction_packets', params: { chain_id: '', tx_hash: SPOKE_TX_HASH } },
          API_URL,
        ),
      ).rejects.toThrow('Invalid input parameters. source_chain_id empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when tx_hash is empty (invariant)', async () => {
      await expect(
        getTransactionPackets(
          { action: 'get_transaction_packets', params: { chain_id: CHAIN_ID, tx_hash: '' } },
          API_URL,
        ),
      ).rejects.toThrow('Invalid input parameters. tx_hash empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

// =========================================================================
// getPacket — POST + invariants on chain_id / tx_hash / conn_sn
// =========================================================================

describe('getPacket', () => {
  const baseParams = { chain_id: CHAIN_ID, tx_hash: SPOKE_TX_HASH, conn_sn: CONN_SN };

  describe('happy paths', () => {
    it('POSTs and returns ok:true wrapping success:true with packet data', async () => {
      const responseBody: GetPacketResponse = { success: true, data: buildPacket() };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const payload: IntentRelayRequest<'get_packet'> = { action: 'get_packet', params: baseParams };
      const result = await getPacket(payload, API_URL);

      expect(result).toEqual({ ok: true, value: responseBody });
      expect(mockFetch).toHaveBeenCalledWith(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    });

    it('returns ok:true wrapping success:false with a message when the relayer cannot find the packet', async () => {
      // GetPacketResponse is a discriminated union — the failure variant carries
      // a `message` instead of `data`. The HTTP call still succeeded, so the
      // service forwards the body verbatim inside an ok:true Result.
      const responseBody: GetPacketResponse = { success: false, message: 'packet not found' };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await getPacket({ action: 'get_packet', params: baseParams }, API_URL);

      expect(result).toEqual({ ok: true, value: responseBody });
    });
  });

  describe('rejects on invalid inputs', () => {
    it('throws when chain_id is empty (invariant)', async () => {
      await expect(
        getPacket(
          { action: 'get_packet', params: { chain_id: '', tx_hash: SPOKE_TX_HASH, conn_sn: CONN_SN } },
          API_URL,
        ),
      ).rejects.toThrow('Invalid input parameters. source_chain_id empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when tx_hash is empty (invariant)', async () => {
      await expect(
        getPacket({ action: 'get_packet', params: { chain_id: CHAIN_ID, tx_hash: '', conn_sn: CONN_SN } }, API_URL),
      ).rejects.toThrow('Invalid input parameters. tx_hash empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when conn_sn is empty (invariant — distinct from the other two)', async () => {
      await expect(
        getPacket(
          { action: 'get_packet', params: { chain_id: CHAIN_ID, tx_hash: SPOKE_TX_HASH, conn_sn: '' } },
          API_URL,
        ),
      ).rejects.toThrow('Invalid input parameters. conn_sn empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

// =========================================================================
// waitUntilIntentExecuted — polling loop, status filter, timeout, error swallow
// =========================================================================

describe('waitUntilIntentExecuted', () => {
  const baseInput = {
    intentRelayChainId: CHAIN_ID,
    srcTxHash: SPOKE_TX_HASH,
    apiUrl: API_URL,
  };

  describe('happy paths', () => {
    it('returns ok:true with the executed packet on the first poll', async () => {
      const packet = buildPacket({ status: 'executed' });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse),
      );

      const result = await waitUntilIntentExecuted(baseInput);

      expect(result).toEqual({ ok: true, value: packet });
      // First poll succeeded — no setTimeout / no second fetch.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('matches src_tx_hash case-insensitively (UPPERCASE relayer response, lowercase request)', async () => {
      // Relayers normalize hashes inconsistently; the service explicitly
      // lowercases both sides before comparing.
      const packet = buildPacket({
        src_tx_hash: SPOKE_TX_HASH.toUpperCase(),
        status: 'executed',
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse),
      );

      const result = await waitUntilIntentExecuted({ ...baseInput, srcTxHash: SPOKE_TX_HASH });

      expect(result).toEqual({ ok: true, value: packet });
    });

    it('selects the packet matching src_tx_hash, ignoring unrelated packets in the response', async () => {
      const unrelated = buildPacket({ src_tx_hash: `0x${'f'.repeat(64)}`, status: 'executed' });
      const target = buildPacket({ src_tx_hash: SPOKE_TX_HASH, status: 'executed' });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: [unrelated, target],
        } satisfies GetTransactionPacketsResponse),
      );

      const result = await waitUntilIntentExecuted(baseInput);

      expect(result).toEqual({ ok: true, value: target });
    });
  });

  describe('keeps polling until the packet is executed', () => {
    it('polls again when the relayer returns success:false', async () => {
      vi.useFakeTimers();
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: false, data: [] })).mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: [buildPacket({ status: 'executed' })],
        } satisfies GetTransactionPacketsResponse),
      );

      const promise = waitUntilIntentExecuted(baseInput);
      // Drive the loop forward: first poll (no match) → 2s setTimeout → second poll (match).
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('polls again when data is an empty array (packet not yet indexed)', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true, data: [] } satisfies GetTransactionPacketsResponse))
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ status: 'executed' })],
          } satisfies GetTransactionPacketsResponse),
        );

      const promise = waitUntilIntentExecuted(baseInput);
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('polls again when no packet matches src_tx_hash', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ src_tx_hash: `0x${'a'.repeat(64)}`, status: 'executed' })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ status: 'executed' })],
          } satisfies GetTransactionPacketsResponse),
        );

      const promise = waitUntilIntentExecuted(baseInput);
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('polls again when the matching packet status is not "executed"', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ status: 'pending' })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ status: 'validating' })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ status: 'executed' })],
          } satisfies GetTransactionPacketsResponse),
        );

      const promise = waitUntilIntentExecuted(baseInput);
      // Three iterations → two 2s back-offs.
      await vi.advanceTimersByTimeAsync(4_000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('returns ok:false short-circuit when getTransactionPackets returns ok:false (network failure)', async () => {
      vi.useFakeTimers();

      // postRequest wraps fetch in `retry` (3 attempts, 2s back-off). After all
      // attempts reject, `retry` rethrows, postRequest's catch returns
      // `{ ok: false, error }`, and waitUntilIntentExecuted's
      // `if (!txPacketsResult.ok) return txPacketsResult` short-circuits the
      // polling loop with the underlying fetch error verbatim.
      mockFetch
        .mockRejectedValueOnce(new Error('network down'))
        .mockRejectedValueOnce(new Error('network down'))
        .mockRejectedValueOnce(new Error('network down'));

      const promise = waitUntilIntentExecuted(baseInput);
      // 3 retry attempts × 2s back-off = 6s; loop exits before the 2s polling pause.
      await vi.advanceTimersByTimeAsync(6_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('network down');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('timeout', () => {
    it('returns ok:false RELAY_TIMEOUT immediately when timeout is 0 (loop body never enters)', async () => {
      // `Date.now() - startTime < timeout` is `0 < 0` → false on first check.
      // No fetch is issued; no setTimeout fires. This pins the strict-`<` boundary
      // so a mutation to `<=` would surface (it'd attempt one poll first).
      const result = await waitUntilIntentExecuted({ ...baseInput, timeout: 0 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_TIMEOUT');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('falls back to DEFAULT_RELAY_TX_TIMEOUT when payload.timeout is omitted', async () => {
      vi.useFakeTimers();
      // Fail every poll so the loop exits via the timeout branch.
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: [] } satisfies GetTransactionPacketsResponse));

      const promise = waitUntilIntentExecuted(baseInput);

      // Advance just under the default → loop should still be running.
      await vi.advanceTimersByTimeAsync(DEFAULT_RELAY_TX_TIMEOUT - 2_000);
      let settled = false;
      promise.then(() => {
        settled = true;
      });
      // Yield a microtask so any imminent settle propagates.
      await Promise.resolve();
      expect(settled).toBe(false);

      // Push past the default → loop must exit and resolve to RELAY_TIMEOUT.
      await vi.advanceTimersByTimeAsync(4_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_TIMEOUT');
    });

    it('outer try/catch: forwards a thrown Date.now() failure as ok:false (defensive path)', async () => {
      // The inner try/catch wraps only the fetch — `Date.now()` and `setTimeout`
      // sit in the outer try. This pins the outer catch so a mutation that
      // removes it (or rethrows) would surface here.
      const dateError = new Error('clock unavailable');
      vi.spyOn(Date, 'now').mockImplementationOnce(() => {
        throw dateError;
      });

      const result = await waitUntilIntentExecuted(baseInput);

      expect(result).toEqual({ ok: false, error: dateError });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('uses the explicit timeout when provided (returns RELAY_TIMEOUT after one poll)', async () => {
      vi.useFakeTimers();
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: [] } satisfies GetTransactionPacketsResponse));

      const promise = waitUntilIntentExecuted({ ...baseInput, timeout: 1_000 });
      // First poll succeeds (returns no packets), then a 2s setTimeout starts.
      // After advancing 2s, the loop check runs and 2s ≥ 1s → RELAY_TIMEOUT.
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_TIMEOUT');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

// =========================================================================
// relayTxAndWaitPacket — orchestrates submitTransaction + waitUntilIntentExecuted
// =========================================================================

describe('relayTxAndWaitPacket', () => {
  describe('happy paths', () => {
    it('submits then resolves with the executed packet from waitUntilIntentExecuted', async () => {
      const packet = buildPacket({ status: 'executed' });
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true, message: 'queued' } satisfies SubmitTxResponse))
        .mockResolvedValueOnce(jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse));

      const result = await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data: NO_DATA,
        chainKey: ChainKeys.BSC_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      expect(result).toEqual({ ok: true, value: packet });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('translates chainKey via getIntentRelayChainId and stringifies it for the submit payload', async () => {
      // BSC_MAINNET → RelayChainIdMap → 4n → '4'. A mutation that drops
      // `.toString()` would leave a bigint in the JSON body and surface here.
      const packet = buildPacket({ status: 'executed' });
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true, message: 'ok' } satisfies SubmitTxResponse))
        .mockResolvedValueOnce(jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse));

      await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data: NO_DATA,
        chainKey: ChainKeys.BSC_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      const submitBody = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
      expect(submitBody.action).toBe('submit');
      expect(submitBody.params).toEqual({ chain_id: '4', tx_hash: SPOKE_TX_HASH });
      // No `data` field when undefined was passed.
      expect(submitBody.params.data).toBeUndefined();
    });

    it('includes RelayExtraData in the submit body when provided (Solana split-tx flow)', async () => {
      const packet = buildPacket({ status: 'executed' });
      const data = { address: '0xhub' as Hex, payload: '0xinstruction' as Hex };
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true, message: 'ok' } satisfies SubmitTxResponse))
        .mockResolvedValueOnce(jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse));

      await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data,
        chainKey: ChainKeys.SOLANA_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      const submitBody = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
      expect(submitBody.params).toEqual({
        chain_id: '1', // Solana → 1n → '1'
        tx_hash: SPOKE_TX_HASH,
        data,
      });
    });

    it('forwards the explicit timeout to waitUntilIntentExecuted', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true, message: 'ok' } satisfies SubmitTxResponse))
        // No packet ever — force the inner loop to time out at the configured value.
        .mockResolvedValue(jsonResponse({ success: true, data: [] } satisfies GetTransactionPacketsResponse));

      const promise = relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data: NO_DATA,
        chainKey: ChainKeys.BSC_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: 1_000,
      });
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_TIMEOUT');
    });
  });

  describe('error propagation', () => {
    it('returns ok:false SUBMIT_TX_FAILED with cause when the relayer rejects the submission', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: false, message: 'invalid tx_hash' } satisfies SubmitTxResponse),
      );

      const result = await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data: NO_DATA,
        chainKey: ChainKeys.BSC_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toBe('SUBMIT_TX_FAILED');
      // The failure message from the relayer is preserved on the underlying cause.
      expect(((result.error as Error).cause as Error).message).toBe('invalid tx_hash');
      // Critical: waitUntilIntentExecuted must NOT have been called.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('catches synchronous failures from getIntentRelayChainId and forwards as ok:false', async () => {
      // `getIntentRelayChainId` does a `RelayChainIdMap[chainKey]` lookup —
      // calling it on a key not in the map yields `undefined` and `.toString()`
      // throws synchronously. The outer try/catch in `relayTxAndWaitPacket`
      // captures this and returns ok:false with the raw error.
      const result = await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data: NO_DATA,
        chainKey: 'unknown_chain' as never,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(Error);
      // No HTTP request issued — failure short-circuits before submitTransaction.
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('rejects on invalid inputs', () => {
    it('returns ok:false when chainKey is Solana and data is undefined (invariant)', async () => {
      // Solana/Bitcoin source chains use a split-tx flow where the on-chain tx
      // carries only a verification hash — the full instruction blob must be
      // shipped via the off-chain `data` field. Omitting `data` for these
      // chains trips an invariant inside `relayTxAndWaitPacket`; the outer
      // try/catch turns it into ok:false with the raw Error.
      const result = await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data: NO_DATA,
        chainKey: ChainKeys.SOLANA_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toMatch(/Data is required/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
