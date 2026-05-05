import type { NearConnector } from '@hot-labs/near-connect';

export type NearTxExecutionStatus =
  | 'NONE'
  | 'INCLUDED'
  | 'EXECUTED_OPTIMISTIC'
  | 'INCLUDED_FINAL'
  | 'EXECUTED'
  | 'FINAL';

/** Defaults applied to every call. Per-call options shallow-merge over these. */
export type NearWalletDefaults = {
  /** Throw on failure flag for `signAndSendTransaction` (PK path). Default `true`. */
  throwOnFailure?: boolean;
  /** Wait-until status for confirmation. Default `'FINAL'`. */
  waitUntil?: NearTxExecutionStatus;
  /** Default gas if tx omits. */
  gasDefault?: bigint;
  /** Default deposit if tx omits. */
  depositDefault?: bigint;
};

/** Configuration for constructing a `NearWalletProvider` backed by a raw private key. */
export type PrivateKeyNearWalletConfig = {
  rpcUrl: string;
  accountId: string;
  privateKey: string;
  defaults?: NearWalletDefaults;
};

/** Configuration for constructing a `NearWalletProvider` backed by a browser-extension wallet. */
export type BrowserExtensionNearWalletConfig = {
  wallet: NearConnector;
  defaults?: NearWalletDefaults;
};

export type NearWalletConfig = PrivateKeyNearWalletConfig | BrowserExtensionNearWalletConfig;
