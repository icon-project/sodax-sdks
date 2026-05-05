import type { SuiClient, SuiTransactionBlockResponseOptions } from '@mysten/sui/client';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SuiWalletFeatures, WalletAccount, WalletWithFeatures } from '@mysten/wallet-standard';

/**
 * signAndExecuteTxn behavior. Pre-flight dry-run is enabled by default — disable only when
 * paying gas for a doomed tx is acceptable. `response` options forward to the underlying
 * SuiClient call (signAndExecuteTransaction in PK mode, executeTransactionBlock in browser-ext).
 */
export type SuiSignAndExecutePolicy = {
  dryRun?: { enabled?: boolean };
  response?: SuiTransactionBlockResponseOptions;
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

/** Configuration for constructing a `SuiWalletProvider` backed by a mnemonic-derived private key. */
export type PrivateKeySuiWalletConfig = {
  rpcUrl: string;
  mnemonics: string;
  defaults?: SuiWalletDefaults;
};

/** Configuration for constructing a `SuiWalletProvider` backed by a browser-extension wallet. */
export type BrowserExtensionSuiWalletConfig = {
  client: SuiClient;
  wallet: WalletWithFeatures<Partial<SuiWalletFeatures>>;
  account: WalletAccount;
  defaults?: SuiWalletDefaults;
};

export type SuiWalletConfig = PrivateKeySuiWalletConfig | BrowserExtensionSuiWalletConfig;

export type PkSuiWallet = {
  keyPair: Ed25519Keypair;
};

export type BrowserExtensionSuiWallet = {
  wallet: WalletWithFeatures<Partial<SuiWalletFeatures>>;
  account: WalletAccount;
};

export type SuiWallet = PkSuiWallet | BrowserExtensionSuiWallet;
