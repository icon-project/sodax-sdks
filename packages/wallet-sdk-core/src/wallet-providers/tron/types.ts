import type { TronSignedTransaction, TronUnsignedTransaction } from '@sodax/types';

/** Defaults applied to every call. Per-call options shallow-merge over these. */
export type TronWalletDefaults = {
  /** TronGrid-compatible RPC used for reads (receipt polling, balance). Default `https://api.trongrid.io`. */
  rpcUrl?: string;
};

/**
 * Minimal TronWeb surface the provider needs (the object `window.tronWeb` / TronLink injects).
 * Kept structural so this package needs no `tronweb` dependency.
 */
export interface TronWebLike {
  defaultAddress?: { base58?: string | false };
  fullNode?: { host?: string };
  trx: {
    sign: (transaction: TronUnsignedTransaction) => Promise<TronSignedTransaction>;
    signMessageV2: (message: string) => Promise<string>;
    getBalance?: (address?: string) => Promise<number>;
  };
}

/** Configuration for constructing a `TronWalletProvider` backed by a raw private key. */
export type PrivateKeyTronWalletConfig = {
  /** 64-hex secp256k1 key (with or without `0x`). */
  privateKey: string;
  /** TronGrid RPC used for signing tx builds, broadcast, and reads. */
  endpoint?: string;
  defaults?: TronWalletDefaults;
};

/** Configuration for constructing a `TronWalletProvider` backed by a browser extension (TronLink). */
export type BrowserExtensionTronWalletConfig = {
  /** The injected `window.tronWeb` object. */
  tronWeb: TronWebLike;
  /** Connected base58 address; falls back to `tronWeb.defaultAddress.base58`. */
  address?: string;
  endpoint?: string;
  defaults?: TronWalletDefaults;
};

export type TronWalletConfig = PrivateKeyTronWalletConfig | BrowserExtensionTronWalletConfig;
