import type { WalletAdapter } from '@provablehq/aleo-wallet-standard';
import type { AleoNetworkEnv, AleoWaitForReceiptOptions } from '@sodax/types';

export type AleoSDK = typeof import('@provablehq/sdk');

/** Delegated proving service configuration for private-key wallets. */
export type DelegateProvingConfig = {
  apiKey: string;
  consumerId: string;
  url?: string;
};

/** Defaults applied to every call. Per-call options shallow-merge over these. */
export type AleoWalletDefaults = {
  /**
   * Default priority fee applied when `execute()` is called without `priorityFee`.
   * Fallbacks if unset: `0` (private-key wallets), `0.001` (browser-extension wallets).
   */
  priorityFee?: number;
  /** Default privacy mode for fees on `execute()`. Default `false`. */
  privateFee?: boolean;
  /**
   * Override URL for the delegated proving service. Only applies to private-key
   * wallets with a `delegate` config. If unset, the URL is derived from `network`:
   * `https://api.provable.com/prove/<mainnet|testnet>`.
   */
  delegateUrl?: string;
  /** Default polling options for `waitForTransactionReceipt()`. */
  waitForReceipt?: AleoWaitForReceiptOptions;
};

/** Configuration for constructing an `AleoWalletProvider` backed by a raw private key. */
export type PrivateKeyAleoWalletConfig = {
  type: 'privateKey';
  rpcUrl: string;
  privateKey: string;
  network: AleoNetworkEnv;
  delegate?: DelegateProvingConfig;
  defaults?: AleoWalletDefaults;
};

/** Configuration for constructing an `AleoWalletProvider` backed by a browser-extension wallet adapter. */
export type BrowserExtensionAleoWalletConfig = {
  type: 'browserExtension';
  rpcUrl: string;
  provableAdapter: WalletAdapter;
  network?: AleoNetworkEnv;
  defaults?: AleoWalletDefaults;
};

export type AleoWalletConfig = PrivateKeyAleoWalletConfig | BrowserExtensionAleoWalletConfig;

export type PkAleoWallet = {
  type: 'privateKey';
  account: InstanceType<Awaited<AleoSDK>['Account']>;
};

export type BrowserExtensionAleoWallet = {
  type: 'browserExtension';
  adapter: WalletAdapter;
};

export type AleoWallet = PkAleoWallet | BrowserExtensionAleoWallet;
