import type { PrivateKeyAccount } from 'viem';
import type { Address, EvmSpokeOnlyChainKey, HubAddress, Hex } from '@sodax/types';
import type { RelayExtraData } from '../shared/types/types.js';

/**
 * Inputs for a gasless (EIP-7702 sponsored) ERC20 spoke deposit.
 *
 * This is a **feature-agnostic primitive**: `to` and `data` are already built by the caller
 * (e.g. via a feature's `create*Intent({ raw: true })` / `buildBridgeData` helper). The service
 * batches `approve(assetManager, amount)` + `assetManager.transfer(token, to, amount, data)` into
 * one sponsored user operation and relays the resulting on-chain tx.
 *
 * Phase 1 supports **Mode B only** (SDK-managed keys): `owner` is a viem {@link PrivateKeyAccount}
 * that signs the EIP-7702 authorization and the user operation. Mode A (external wallets via
 * EIP-5792) is a future addition; when it lands, an external-wallet channel is added and `owner`
 * becomes optional (additive, non-breaking).
 */
export type GaslessDepositParams = {
  /** Source EVM spoke chain. Must be gasless-configured (see `Sodax({ gasless })`). */
  srcChainKey: EvmSpokeOnlyChainKey;
  /** User EOA on the spoke chain. Must equal `owner.address` (EIP-7702 preserves the EOA address). */
  srcAddress: Address;
  /** ERC20 token to deposit. Native token is rejected (gasless has no approve/value story for it). */
  token: Address;
  /** Amount to deposit, in token base units. */
  amount: bigint;
  /** Hub recipient — derived from the EOA via `hubProvider.getUserHubWalletAddress(EOA, chainKey)`. */
  to: HubAddress;
  /** Hub action payload built by the caller (bridge/supply/etc.). */
  data: Hex;
  /** Mode B signer: signs the EIP-7702 authorization + user operation. */
  owner: PrivateKeyAccount;
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
