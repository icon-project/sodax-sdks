import type { HttpUrl, SpokeChainKey, Hex } from '@sodax/types';

export type RelayExtraData = { address: Hex; payload: Hex };

/**
 * Signed Bitcoin on-demand payload (money-market borrow/withdraw) carried in the relay submit
 * `data` as a JSON object — not a stringified JSON. There is no broadcast tx for these.
 * `public_key` is the signer's public key, required by the relay to verify a BIP-322 signature
 * (BIP-322 is not public-key-recoverable, unlike BIP-137).
 */
export type OnDemandRelayData = { payload_hex: string; signature?: string; public_key?: string };

export type IntentDeliveryInfo = {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
  srcAddress: string;
  dstChainKey: SpokeChainKey;
  dstTxHash: string;
  dstAddress: string;
};

export type RelayTxStatus = 'pending' | 'validating' | 'executing' | 'executed';

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

export type WaitUntilIntentExecutedPayload = {
  intentRelayChainId: string;
  srcTxHash: string;
  timeout?: number;
  apiUrl: HttpUrl;
  /**
   * Disambiguates when a single src tx emits multiple relay packets. Receives the candidates
   * already filtered by `srcTxHash` and `src_chain_id` (so only packets for the awaited
   * transaction and source chain reach it) and returns the desired one (or undefined to keep
   * polling). Defaults to "first candidate" — the legacy behavior for single-packet flows.
   */
  selectPacket?: (packets: PacketData[]) => PacketData | undefined;
};

export type RelayAction = 'submit' | 'get_transaction_packets' | 'get_packet';

export type IntentRelayRequest<T extends RelayAction> = {
  action: T;
  params: T extends 'submit'
    ? { chain_id: string; tx_hash: string; data?: RelayExtraData | OnDemandRelayData }
    : T extends 'get_transaction_packets'
      ? { chain_id: string; tx_hash: string }
      : T extends 'get_packet'
        ? { chain_id: string; tx_hash: string; conn_sn: string }
        : never;
};
