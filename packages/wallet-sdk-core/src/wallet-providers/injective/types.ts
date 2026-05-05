import type { Network } from '@injectivelabs/networks';
import type { MsgBroadcasterWithPk } from '@injectivelabs/sdk-ts';
import type { ChainId, EvmChainId } from '@injectivelabs/ts-types';
import type { MsgBroadcaster } from '@injectivelabs/wallet-core';
import type { InjectiveCoin } from '@sodax/types';

/**
 * Defaults applied to every call. Per-call options shallow-merge over these.
 * `msgBroadcaster` options apply at construction time only (private-key path) —
 * the upstream MsgBroadcasterWithPk doesn't support post-construction reconfig.
 */
export type InjectiveWalletDefaults = {
  /** Coins attached to `getRawTransaction`/`execute` if caller doesn't supply funds. */
  defaultFunds?: InjectiveCoin[];
  /** Default memo on transactions. */
  defaultMemo?: string;
  /** Sequence override for `createTransaction`. Default 0. */
  sequence?: number;
  /** Account number override for `createTransaction`. Default 0. */
  accountNumber?: number;
};

export type BrowserExtensionInjectiveWalletConfig = {
  msgBroadcaster: MsgBroadcaster;
  defaults?: InjectiveWalletDefaults;
};

/**
 * Server-side / private-key Injective wallet configuration.
 *
 * Unlike most providers that accept a top-level `privateKey`, Injective nests
 * credentials under `secret` to accommodate both a raw private key and a BIP-39
 * mnemonic phrase as first-class alternatives:
 *
 * ```ts
 * // Private-key variant
 * { secret: { privateKey: '0x…' }, chainId, network }
 *
 * // Mnemonic variant
 * { secret: { mnemonics: 'word1 word2 …' }, chainId, network }
 * ```
 *
 * This mirrors the `PrivateKey.fromPrivateKey` / `PrivateKey.fromMnemonic` split
 * in `@injectivelabs/sdk-ts` and avoids a union at the config root.
 */
export type SecretInjectiveWalletConfig = {
  secret: { privateKey: string } | { mnemonics: string };
  chainId: ChainId;
  network: Network;
  /**
   * Reserved for future EVM-sidecar support on Injective.
   *
   * @remarks Currently unused — `InjectiveWalletProvider` does not read this
   * field. It is declared here to keep the config shape stable while EVM
   * compatibility is under development.
   */
  evmOptions?: {
    evmChainId: EvmChainId;
    rpcUrl: `http${string}`;
  };
  defaults?: InjectiveWalletDefaults;
};

export type InjectiveWalletConfig = BrowserExtensionInjectiveWalletConfig | SecretInjectiveWalletConfig;

export type InjectiveWallet = {
  msgBroadcaster: MsgBroadcaster | MsgBroadcasterWithPk;
};
