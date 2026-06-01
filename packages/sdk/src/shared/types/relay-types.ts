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

export type WaitUntilIntentExecutedPayload = {
  intentRelayChainId: string;
  srcTxHash: string;
  timeout?: number;
  apiUrl: HttpUrl;
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
