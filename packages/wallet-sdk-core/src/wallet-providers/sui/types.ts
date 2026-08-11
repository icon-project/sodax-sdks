import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SuiTransaction } from '@sodax/types';

/**
 * signAndExecuteTxn behavior. Pre-flight dry-run is enabled by default — disable only when
 * paying gas for a doomed tx is acceptable.
 */
export type SuiSignAndExecutePolicy = {
  dryRun?: { enabled?: boolean };
};

/** getCoins pagination policy. */
export type SuiGetCoinsPolicy = {
  limit?: number;
};

/** Defaults applied to every call. Per-call options shallow-merge over these. */
export type SuiWalletDefaults = {
  signAndExecuteTxn?: SuiSignAndExecutePolicy;
  getCoins?: SuiGetCoinsPolicy;
};

/** Base64 transaction bytes plus the wallet's signature, as returned by wallet-standard signers. */
export type SuiSignedTransaction = {
  bytes: string;
  signature: string;
};

/** Configuration for constructing a `SuiWalletProvider` backed by a mnemonic-derived private key. */
export type PrivateKeySuiWalletConfig = {
  grpcUrl?: string;
  /**
   * @deprecated Renamed to `grpcUrl`. Still honored, and wins over `grpcUrl` when set. The endpoint
   * must speak gRPC-web — a `sui-node` serves it on the same origin it served JSON-RPC on.
   */
  rpcUrl?: string;
  mnemonics: string;
  defaults?: SuiWalletDefaults;
};

/** Configuration for constructing a `SuiWalletProvider` backed by a browser-extension wallet. */
export type BrowserExtensionSuiWalletConfig = {
  grpcUrl: string;
  address: string;
  /** Signs without broadcasting — pass `dAppKit.signTransaction` or any wallet-standard signer. */
  signTransaction: (txn: SuiTransaction) => Promise<SuiSignedTransaction>;
  defaults?: SuiWalletDefaults;
};

export type SuiWalletConfig = PrivateKeySuiWalletConfig | BrowserExtensionSuiWalletConfig;

export type PkSuiWallet = {
  keyPair: Ed25519Keypair;
};

export type BrowserExtensionSuiWallet = {
  address: string;
  signTransaction: (txn: SuiTransaction) => Promise<SuiSignedTransaction>;
};

export type SuiWallet = PkSuiWallet | BrowserExtensionSuiWallet;
