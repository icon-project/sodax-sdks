import {
  DEFAULT_RELAY_TX_TIMEOUT,
  type HttpUrl,
  type Result,
  type SpokeChainKey,
  getIntentRelayChainId,
} from '@sodax/types';
import invariant from 'tiny-invariant';
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

    return { ok: true, value: await response.json() };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Submits a transaction to the intent relay service.
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

    if (!submitResult.ok) return submitResult;
    const submitTxResponse = submitResult.value;
    if (!submitTxResponse.success) {
      return { ok: false, error: new Error('SUBMIT_TX_FAILED', { cause: new Error(submitTxResponse.message) }) };
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

        if (!txPacketsResult.ok) return txPacketsResult;

        const txPackets = txPacketsResult.value;

        if (txPackets.success && txPackets.data.length > 0) {
          const packet = txPackets.data.find(
            packet => packet.src_tx_hash.toLowerCase() === payload.srcTxHash.toLowerCase(),
          );

          if (txPackets.success && txPackets.data.length > 0 && packet && packet.status === 'executed') {
            return { ok: true, value: packet };
          }
        }
      } catch (e) {
        console.error('Error getting transaction packets', e);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return { ok: false, error: new Error('RELAY_TIMEOUT') };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Submit the transaction to the Solver API and wait for it to be executed
 * @param spokeTxHash - The transaction hash to submit.
 * @param data - The additional data to submit when relaying the transaction on Solana. Due to Solana's 1232 byte transaction
 *               size limit, Solana transactions are split: the on-chain tx contains only a verification hash, while the full
 *               data is submitted off-chain via the relayer. Contains the to address on Hub chain and instruction data.
 * @param chainkey - The chain ID of the transaction.
 * @param timeout - The timeout in milliseconds for the transaction. Default is 20 seconds.
 * @returns The transaction hash.
 */
export async function relayTxAndWaitPacket(params: RelayAndWaitParams): Promise<Result<PacketData>> {
  try {
    const { srcTxHash, data, chainKey, relayerApiEndpoint, timeout = DEFAULT_RELAY_TX_TIMEOUT } = params;
    const intentRelayChainId = getIntentRelayChainId(chainKey).toString();

    const submitPayload: IntentRelayRequest<'submit'> = {
      action: 'submit',
      params:
        isSolanaChainKeyType(chainKey) || isBitcoinChainKeyType(chainKey)
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
    const submitTxResponse = submitResult.value;

    if (!submitTxResponse.success) {
      return { ok: false, error: new Error('SUBMIT_TX_FAILED', { cause: new Error(submitTxResponse.message) }) };
    }

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
