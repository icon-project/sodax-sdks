import type { PrivateKeyAccount } from 'viem';
import type { Address, EvmSpokeOnlyChainKey, HubAddress, Hex, IGaslessCapableEvmWalletProvider } from '@sodax/types';
import type { RelayExtraData } from '../shared/types/types.js';

/**
 * Inputs for a gasless (EIP-7702 sponsored) ERC20 spoke deposit.
 *
 * This is a **feature-agnostic primitive**: `to` and `data` are already built by the caller
 * (e.g. via a feature's `create*Intent({ raw: true })` / `buildBridgeData` helper). The service
 * batches `approve(assetManager, amount)` + `assetManager.transfer(token, to, amount, data)` into
 * one sponsored user operation and relays the resulting on-chain tx.
 *
 * Provide **exactly one** signer:
 * - `owner` — **Mode B** (SDK-managed key): a viem {@link PrivateKeyAccount} signs the EIP-7702
 *   authorization + user operation, submitted through a bundler.
 * - `walletProvider` — **Mode A** (external wallet): an EIP-5792-capable EVM wallet provider
 *   (MetaMask/Rabby/Coinbase) executes the atomic batch with a sponsoring paymaster.
 */
export type GaslessDepositParams = {
  /** Source EVM spoke chain. Must be gasless-configured (see `Sodax({ gasless })`). */
  srcChainKey: EvmSpokeOnlyChainKey;
  /** User EOA on the spoke chain. Must equal the signer's address (EIP-7702 preserves the EOA address). */
  srcAddress: Address;
  /** ERC20 token to deposit. Native token is rejected (gasless has no approve/value story for it). */
  token: Address;
  /** Amount to deposit, in token base units. */
  amount: bigint;
  /** Hub recipient — derived from the EOA via `hubProvider.getUserHubWalletAddress(EOA, chainKey)`. */
  to: HubAddress;
  /** Hub action payload built by the caller (bridge/supply/etc.). */
  data: Hex;
  /** Mode B signer (SDK-managed key). Mutually exclusive with {@link walletProvider}. */
  owner?: PrivateKeyAccount;
  /** Mode A signer (external EIP-5792 wallet). Mutually exclusive with {@link owner}. */
  walletProvider?: IGaslessCapableEvmWalletProvider;
  /**
   * When gasless is unavailable (chain unconfigured, or the wallet lacks atomic-batch / paymaster
   * support), opt into degrading to the normal **user-paid** approve+deposit flow instead of
   * returning an error. Only meaningful in Mode A (requires a `walletProvider` to sign). Default
   * `false` — an unsupported deposit returns a typed error.
   */
  allowGasFallback?: boolean;
  /** Relay wait timeout in ms. Defaults to the relay helper's `DEFAULT_RELAY_TX_TIMEOUT`. */
  timeout?: number;
};

/**
 * Spoke-side result of a gasless deposit: the on-chain tx hash of the atomic batch plus the
 * `relayData` needed to relay to the hub. Returned by `createGaslessDepositIntent` for callers
 * that want manual relay control; `deposit` consumes it internally.
 */
export type GaslessDepositIntent = {
  srcChainTxHash: string;
  relayData: RelayExtraData;
};

/** How a gasless deposit resolves at runtime for a given chain + signer. */
export type GaslessMode = 'walletCalls' | 'smartAccount' | 'unsupported';

/** Result of capability detection — lets a dApp decide whether to offer the gasless option. */
export type GaslessCapabilities = {
  chainKey: EvmSpokeOnlyChainKey;
  /** Chain is gasless-configured (EIP-7702 live + endpoints available). */
  configured: boolean;
  /** Mode A: the wallet advertises atomic batching (or Mode B, which is atomic by construction). */
  atomicSupported: boolean;
  /** Mode A: the wallet advertises ERC-7677 paymaster support (or Mode B, always sponsored). */
  paymasterSupported: boolean;
  /** The mode `deposit()` would actually use. `unsupported` → gasless not possible for this input. */
  resolvedMode: GaslessMode;
};

/** Inputs for capability detection (does not execute anything). */
export type GaslessCapabilitiesParams = {
  chainKey: EvmSpokeOnlyChainKey;
  owner?: PrivateKeyAccount;
  walletProvider?: IGaslessCapableEvmWalletProvider;
};
