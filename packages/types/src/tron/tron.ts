import type { ICoreWallet } from '../wallet/wallet.js';

/**
 * Tron types for the MPC (memo-mode) deposit flow. Tron does NOT ride the intent relay — deposits
 * are plain TRX/TRC-20 transfers to the shared MPC reserve carrying a 32-byte payload-hash memo,
 * picked up by the NEAR chain-signatures relay. See `MpcRelayApiService` in the sdk package.
 */

/** An unsigned Tron transaction as returned by TronGrid `createtransaction` / `triggersmartcontract`. */
export interface TronUnsignedTransaction {
  /** sha256 of `raw_data_hex` — the digest Tron actually signs. */
  txID: string;
  /** Hex protobuf of the transaction body (memo already spliced in for memo-mode deposits). */
  raw_data_hex: string;
  /** Decoded body, when the node returns it. Opaque here. */
  raw_data?: unknown;
  visible?: boolean;
}

/** A Tron transaction carrying its signature(s) (`r||s||v` hex), ready to broadcast. */
export interface TronSignedTransaction extends TronUnsignedTransaction {
  signature: string[];
}

/**
 * Structural raw-tx shape shared with the other spoke chains (see `RawTxReturnType`). `to` is the
 * MPC reserve the funds go to and `data` the memo to tag the transfer with, for both a native TRX
 * transfer and a TRC-20 one — `token` is what distinguishes them (the zero sentinel for native),
 * since a TRC-20 deposit is a `transfer` call on that contract rather than a value transfer.
 */
export type TronRawTransaction = {
  from: string;
  to: string;
  value: bigint;
  data: string;
  token: string;
};

export type TronReturnType<Raw extends boolean> = Raw extends true
  ? TronRawTransaction
  : Raw extends false
    ? string
    : TronRawTransaction | string;

/** TronGrid `gettransactioninfobyid` response (the fields the relay/sdk actually read). */
export type TronRawTransactionReceipt = {
  id: string; // transaction id (hash), hex without 0x
  blockNumber?: number;
  blockTimeStamp?: number;
  fee?: number;
  receipt?: {
    result?: string; // 'SUCCESS' | 'REVERT' | ... ; absent for plain TRX transfers
    energy_usage_total?: number;
    net_usage?: number;
    net_fee?: number;
  };
  contractResult?: string[];
};

export interface ITronWalletProvider extends ICoreWallet {
  readonly chainType: 'TRON';
  /**
   * Sign an unsigned Tron transaction (TronWeb-shaped: signs `txID`, attaching `signature`).
   * The sdk builds the memo transfer and computes `txID`; the wallet only holds the key.
   */
  signTransaction: (tx: TronUnsignedTransaction) => Promise<TronSignedTransaction>;
  /**
   * Sign a 32-byte withdrawal-auth digest (scheme 1: Tron `signMessageV2`, which UTF-8 encodes the
   * `"0x"`-prefixed lowercase hex STRING of the hash — 66 characters — under the
   * `"\x19TRON Signed Message:\n66"` prefix, NOT the raw 32 bytes).
   * Returns the 65-byte `r‖s‖v` signature hex.
   * Used by the hub→Tron withdraw/borrow flow.
   */
  signMessage: (hash: `0x${string}`) => Promise<`0x${string}`>;
  waitForTransactionReceipt: (txHash: string) => Promise<TronRawTransactionReceipt>;
  /** Broadcast an already-signed transaction via a Tron node. Returns the tx id. */
  sendTransaction?: (signedTx: TronSignedTransaction) => Promise<string>;
}
