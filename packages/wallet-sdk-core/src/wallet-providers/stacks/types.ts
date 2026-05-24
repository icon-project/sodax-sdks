import type { PostConditionMode } from '@sodax/libs/stacks/core';
import type { StacksProvider } from '@sodax/libs/stacks/connect';

/** Defaults applied to every call. Per-call options shallow-merge over these. */
export type StacksWalletDefaults = {
  /** Network selector. Default `'mainnet'`. */
  network?: 'mainnet' | 'testnet';
  /** Default post-condition mode if not present in tx params. */
  postConditionMode?: PostConditionMode;
};

/** Configuration for constructing a `StacksWalletProvider` backed by a raw private key. */
export type PrivateKeyStacksWalletConfig = {
  privateKey: string;
  endpoint?: string;
  defaults?: StacksWalletDefaults;
};

/** Configuration for constructing a `StacksWalletProvider` backed by a browser-extension wallet. */
export type BrowserExtensionStacksWalletConfig = {
  address: string;
  endpoint?: string;
  provider?: StacksProvider;
  defaults?: StacksWalletDefaults;
};

export type StacksWalletConfig = PrivateKeyStacksWalletConfig | BrowserExtensionStacksWalletConfig;

export type StacksPkWallet = {
  type: 'PRIVATE_KEY';
  privateKey: string;
};

export type StacksBrowserExtensionWallet = {
  type: 'BROWSER_EXTENSION';
  address: string;
  provider?: StacksProvider;
};

export type StacksWallet = StacksPkWallet | StacksBrowserExtensionWallet;
