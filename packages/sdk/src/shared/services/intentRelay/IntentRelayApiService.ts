import {
  DEFAULT_RELAY_TX_TIMEOUT,
  type HttpUrl,
  type Result,
  type SpokeChainKey,
  getIntentRelayChainId,
} from '@sodax/types';
import { invariant } from '../../utils/tiny-invariant.js';
import { retry } from '../../utils/shared-utils.js';
import type {
  RelayAction,
  RelayExtraData,
  IntentDeliveryInfo,
  IntentRelayRequest,
  WaitUntilIntentExecutedPayload,
} from '../../types/relay-types.js';
import { isBitcoinChainKeyType, isSolanaChainKeyType } from '../../guards.js';

export type { RelayAction, RelayExtraData, IntentDeliveryInfo, IntentRelayRequest, WaitUntilIntentExecutedPayload };

export type RelayTxStatus = 'pending' | 'validating' | 'executing' | 'executed';

/**
 * Stable error message strings emitted by relay-layer helpers ({@link submitTransaction},
 * {@link relayTxAndWaitPacket}) on failure.
 *
 * **Public contract** — callers across the SDK rely on these literal strings for error
 * discrimination. They MUST NOT be renamed without coordinating callers (see swap module's
 * `mapRelayFailureToSwapError` and the per-module relay-error handling in moneyMarket,
 * bridge, dex, migration, staking).
 */
export const RELAY_ERROR_CODES = {
  /** The spoke tx landed but the relay POST submit call failed (HTTP error, malformed response). */
  SUBMIT_TX_FAILED: 'SUBMIT_TX_FAILED',
  /**
   * Polling completed cleanly but the destination packet never reached `status: 'executed'`
   * within the timeout. Distinguish from {@link RELAY_ERROR_CODES.RELAY_POLLING_FAILED}: this
   * means polling worked, the relay just didn't deliver in time.
   */
  RELAY_TIMEOUT: 'RELAY_TIMEOUT',
  /**
   * Polling itself failed: the polling endpoint kept returning network errors or threw
   * exceptions during the wait window. The original polling error is on `error.cause`.
   * Operators should treat this as a relay-API outage, not a slow packet.
   */
  RELAY_POLLING_FAILED: 'RELAY_POLLING_FAILED',
} as const;

export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[keyof typeof RELAY_ERROR_CODES];

export type SubmitTxParams = {
  chain_id: string;
  tx_hash: string;
  data?: RelayExtraData;
};

export type GetTransactionPacketsParams = {
  chain_id: string;
  tx_hash: string;
};

export type GetPacketParams = {
  chain_id: string;
  tx_hash: string;
  conn_sn: string;
};

export type SubmitTxResponse = {
  success: boolean;
  message: string;
};

export type PacketData = {
  src_chain_id: number;
  src_tx_hash: string;
  src_address: string;
  status: RelayTxStatus;
  dst_chain_id: number;
  conn_sn: number;
  dst_address: string;
  dst_tx_hash: string;
  signatures: string[];
  payload: string;
};

export type GetTransactionPacketsResponse = {
  success: boolean;
  data: PacketData[];
};

export type GetPacketResponse =
  | {
      success: true;
      data: PacketData;
    }
  | {
      success: false;
      message: string;
    };

export type GetRelayRequestParamType<T extends RelayAction> = T extends 'submit'
  ? SubmitTxParams
  : T extends 'get_transaction_packets'
    ? GetTransactionPacketsParams
    : T extends 'get_packet'
      ? GetPacketParams
      : never;

export type GetRelayResponse<T extends RelayAction> = T extends 'submit'
  ? SubmitTxResponse
  : T extends 'get_transaction_packets'
    ? GetTransactionPacketsResponse
    : T extends 'get_packet'
      ? GetPacketResponse
      : never;

export type IntentRelayRequestParams = SubmitTxParams | GetTransactionPacketsParams | GetPacketParams;

export type RelayAndWaitParams = {
  srcTxHash: string;
  data: RelayExtraData;
  chainKey: SpokeChainKey;
  relayerApiEndpoint: HttpUrl;
  timeout: number | undefined;
};

async function postRequest<T extends RelayAction>(
  payload: IntentRelayRequest<T>,
  apiUrl: string,
): Promise<Result<GetRelayResponse<T>>> {
  try {
    const response = await retry(() =>
      fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
    );

    // Guard against HTTP-level failures: a 4xx/5xx that returns a JSON body shaped like
    // `{ success: true, ... }` (buggy gateway, CDN, middleware) would otherwise be treated
    // as a relay success. Aligns with `SolverApiService`, which has always checked this.
    if (!response.ok) {
      const statusText = response.statusText || 'unknown';
      let body = '';
      try {
        body = await response.text();
      } catch {
        // Body read failures are non-fatal — preserve the status info even without it.
      }
      const detail = body ? `${statusText}: ${body.slice(0, 200)}` : statusText;
      return { ok: false, error: new Error(`HTTP ${response.status}: ${detail}`) };
    }

    return { ok: true, value: await response.json() };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Submits a transaction to the intent relay service.
 *
 * @public
 *
 * **Failure contract** — every failure mode (HTTP error, network/transport error, malformed
 * response body, or relayer-reported `success: false`) surfaces as
 * `{ ok: false, error: new Error(RELAY_ERROR_CODES.SUBMIT_TX_FAILED, { cause }) }`. The
 * underlying error is preserved on `error.cause` for diagnostics. The literal string
 * `'SUBMIT_TX_FAILED'` is part of the public relay-layer contract and is relied on by swap,
 * moneyMarket, bridge, dex, migration, and staking for error discrimination. Renaming
 * requires coordinated updates across all callers — prefer adding a new code to
 * {@link RELAY_ERROR_CODES} over renaming.
 *
 * @param payload - The request payload containing the 'submit' action type and parameters.
 * @param apiUrl - The URL of the intent relay service.
 * @returns The response from the intent relay service.
 */
export async function submitTransaction(
  payload: IntentRelayRequest<'submit'>,
  apiUrl: HttpUrl,
): Promise<Result<GetRelayResponse<'submit'>>> {
  invariant(payload.params.chain_id.length > 0, 'Invalid input parameters. source_chain_id empty');
  invariant(payload.params.tx_hash.length > 0, 'Invalid input parameters. tx_hash empty');

  try {
    const submitResult = await postRequest(payload, apiUrl);

    if (!submitResult.ok) {
      // postRequest's failure modes (HTTP non-2xx, network errors after retries, JSON parse
      // failures) are all submit-side failures from the caller's perspective. Wrap as the
      // canonical SUBMIT_TX_FAILED so swap/moneyMarket/etc. discriminators see one code.
      return {
        ok: false,
        error: new Error(RELAY_ERROR_CODES.SUBMIT_TX_FAILED, { cause: submitResult.error }),
      };
    }
    const submitTxResponse = submitResult.value;
    if (!submitTxResponse.success) {
      return {
        ok: false,
        error: new Error(RELAY_ERROR_CODES.SUBMIT_TX_FAILED, { cause: new Error(submitTxResponse.message) }),
      };
    }
    return { ok: true, value: submitTxResponse };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Retrieves transaction packets from the intent relay service.
 * @param payload - The request payload containing the 'get_transaction_packets' action type and parameters.
 * @param apiUrl - The URL of the intent relay service.
 * @returns The response from the intent relay service.
 */
export async function getTransactionPackets(
  payload: IntentRelayRequest<'get_transaction_packets'>,
  apiUrl: HttpUrl,
): Promise<Result<GetRelayResponse<'get_transaction_packets'>>> {
  invariant(payload.params.chain_id.length > 0, 'Invalid input parameters. source_chain_id empty');
  invariant(payload.params.tx_hash.length > 0, 'Invalid input parameters. tx_hash empty');

  return postRequest(payload, apiUrl);
}

/**
 * Retrieves a packet from the intent relay service.
 * @param payload - The request payload containing the 'get_packet' action type and parameters.
 * @param apiUrl - The URL of the intent relay service.
 * @returns The response from the intent relay service.
 */
export async function getPacket(
  payload: IntentRelayRequest<'get_packet'>,
  apiUrl: HttpUrl,
): Promise<Result<GetRelayResponse<'get_packet'>>> {
  invariant(payload.params.chain_id.length > 0, 'Invalid input parameters. source_chain_id empty');
  invariant(payload.params.tx_hash.length > 0, 'Invalid input parameters. tx_hash empty');
  invariant(payload.params.conn_sn.length > 0, 'Invalid input parameters. conn_sn empty');

  return postRequest(payload, apiUrl);
}

export async function waitUntilIntentExecuted(payload: WaitUntilIntentExecutedPayload): Promise<Result<PacketData>> {
  try {
    const timeout = payload.timeout ?? DEFAULT_RELAY_TX_TIMEOUT;
    const startTime = Date.now();
    // Track the last observed polling-side failure so the post-loop emit path can distinguish
    // a genuine RELAY_TIMEOUT (polling worked, packet didn't land) from RELAY_POLLING_FAILED
    // (polling never recovered). Without this, both surface identically as RELAY_TIMEOUT.
    let lastPollingError: unknown;

    while (Date.now() - startTime < timeout) {
      try {
        const txPacketsResult = await getTransactionPackets(
          {
            action: 'get_transaction_packets',
            params: {
              chain_id: payload.intentRelayChainId,
              tx_hash: payload.srcTxHash,
            },
          },
          payload.apiUrl,
        );

        if (!txPacketsResult.ok) {
          // postRequest already retried (3 attempts). Persistent failure — stop polling and
          // surface as RELAY_POLLING_FAILED in the post-loop block, with the underlying
          // network/parse error preserved as `cause`.
          lastPollingError = txPacketsResult.error;
          break;
        }

        const txPackets = txPacketsResult.value;

        if (txPackets.success && txPackets.data.length > 0) {
          const packet = txPackets.data.find(
            packet => packet.src_tx_hash.toLowerCase() === payload.srcTxHash.toLowerCase(),
          );

          if (packet?.status === 'executed') {
            return { ok: true, value: packet };
          }
        }
      } catch (e) {
        // Sync exceptions inside the loop body (e.g. invariant fires on bad payload, or a
        // future code path throws). Record so the post-loop path surfaces RELAY_POLLING_FAILED
        // instead of a misleading RELAY_TIMEOUT.
        lastPollingError = e;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (lastPollingError !== undefined) {
      return {
        ok: false,
        error: new Error(RELAY_ERROR_CODES.RELAY_POLLING_FAILED, { cause: lastPollingError }),
      };
    }
    return { ok: false, error: new Error(RELAY_ERROR_CODES.RELAY_TIMEOUT) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Submit the transaction to the Solver API and wait for it to be executed.
 *
 * @public
 *
 * **Failure contract** — this helper returns `{ ok: false, error: new Error(<CODE>, { cause }) }`
 * with one of two stable code strings on `error.message`. The literal strings are part of the
 * public relay-layer contract (also exported as {@link RELAY_ERROR_CODES}) and are relied on
 * by swap, moneyMarket, bridge, dex, migration, and staking for error discrimination.
 * Renaming requires coordinated updates across all callers.
 *
 * - `RELAY_ERROR_CODES.SUBMIT_TX_FAILED` — the spoke tx landed but the relay submit call
 *   failed (HTTP error, malformed response). Critical: the user's funds may already be in
 *   flight; callers should persist the spokeTxHash and retry submit.
 * - `RELAY_ERROR_CODES.RELAY_TIMEOUT` — submit succeeded, polling worked, but the destination
 *   packet did not reach `status: 'executed'` within `timeout`. The relay was reachable; it
 *   just didn't deliver in time.
 * - `RELAY_ERROR_CODES.RELAY_POLLING_FAILED` — submit succeeded but polling itself never
 *   recovered (persistent network errors or sync exceptions during the wait window). The
 *   packet's actual status is unknown; query the hub directly to confirm. The original
 *   polling error is preserved on `error.cause`.
 *
 * @param spokeTxHash - The transaction hash to submit.
 * @param data - The additional data to submit when relaying the transaction on Solana or Bitcoin.
 *               These chains use split transactions: the on-chain tx contains only a verification hash,
 *               while the full call data is submitted off-chain via the relayer. Contains the destination
 *               address on the Hub chain and the instruction payload. Required for Solana and Bitcoin;
 *               ignored for all other chains.
 * @param chainKey - The chain key identifying the source chain of the transaction.
 * @param timeout - The timeout in milliseconds to wait for the relay packet. Defaults to
 *   `DEFAULT_RELAY_TX_TIMEOUT` (120,000 ms / 120 seconds).
 * @returns A `Result<PacketData>` where `PacketData` contains the relay packet details:
 *   `src_chain_id`, `src_tx_hash`, `src_address`, `dst_chain_id`, `dst_tx_hash`, `dst_address`,
 *   `conn_sn`, `status` (`'executed'` when complete), `payload`, and `signatures`.
 *   Use `dst_tx_hash` as the hub-chain transaction hash for subsequent solver interactions.
 */
export async function relayTxAndWaitPacket(params: RelayAndWaitParams): Promise<Result<PacketData>> {
  try {
    const { srcTxHash, data, chainKey, relayerApiEndpoint, timeout = DEFAULT_RELAY_TX_TIMEOUT } = params;
    const intentRelayChainId = getIntentRelayChainId(chainKey).toString();

    const isSplitTxChain = isSolanaChainKeyType(chainKey) || isBitcoinChainKeyType(chainKey);
    invariant(!isSplitTxChain || data !== undefined, 'Data is required for Solana and Bitcoin chain keys');

    const submitPayload: IntentRelayRequest<'submit'> = {
      action: 'submit',
      params: isSplitTxChain
        ? {
            chain_id: intentRelayChainId,
            tx_hash: srcTxHash,
            data,
          }
        : {
            chain_id: intentRelayChainId,
            tx_hash: srcTxHash,
          },
    };

    const submitResult = await submitTransaction(submitPayload, relayerApiEndpoint);
    if (!submitResult.ok) return submitResult;

    return await waitUntilIntentExecuted({
      intentRelayChainId,
      srcTxHash,
      timeout,
      apiUrl: relayerApiEndpoint,
    });
  } catch (error) {
    return { ok: false, error };
  }
}
