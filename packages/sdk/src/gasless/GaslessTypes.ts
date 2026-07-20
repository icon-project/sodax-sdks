import type {
  Address,
  EvmSpokeOnlyChainKey,
  HubAddress,
  Hex,
  IGaslessApi,
  IGaslessCapableEvmWalletProvider,
} from '@sodax/types';
import type { Resultified } from '../backendApi/api-utils.js';
import type { RelayExtraData, TxHashPair } from '../shared/types/types.js';
import type { GaslessCall } from './internal/buildDepositCalls.js';

/** SDK-side view of {@link IGaslessApi}: every wire method wrapped in `Result<T>` (the brain never throws for a feature-level failure). Both `sodax.gasless` and `sodax.api.gasless` satisfy it, so a consumer can swap brain ↔ backend without a shape change. */
export type ResultifiedGaslessApi = Resultified<IGaslessApi>;

/**
 * Per-request sponsorship override for the brain's `prepare` / `sendCalls`.
 *
 * Deliberately **off the wire DTO** (never part of {@link IGaslessApi}) so an untrusted HTTP client
 * cannot name someone else's policy. It overrides the per-chain sponsorship frozen at `new Sodax(...)`
 * (`GaslessChainConfig.sponsorshipPolicyId` / `paymasterContext`), letting a single instance sponsor
 * different senders under different policies — the backend resolves the policy from its own auth and
 * passes it here, rather than standing up a `Sodax` per partner.
 */
export type GaslessSponsorshipOptions = {
  /** Pimlico sponsorship policy id; wrapped into `{ sponsorshipPolicyId }` paymaster context. */
  sponsorshipPolicyId?: string;
  /** Full ERC-7677 paymaster context; wins over both `sponsorshipPolicyId` and the per-chain default. */
  paymasterContext?: Record<string, unknown>;
};

/** Internal, bigint-typed inputs for the `[approve, transfer]` batch; the wire DTOs use string amounts, converted once at the brain boundary. */
export type GaslessBatchInput = {
  srcChainKey: EvmSpokeOnlyChainKey;
  srcAddress: Address;
  token: Address;
  amount: bigint;
  to: HubAddress;
  data: Hex;
};

/**
 * Result of the brain-only {@link GaslessService.buildSendCalls}: the server-built Mode-A batch, so a
 * NON-SDK (pure-HTTP) consumer can drive EIP-5792 `wallet_sendCalls` in its own browser wallet without
 * importing the SDK or re-implementing the `[approve, transfer]` ABI encoding. `paymaster` is present only
 * when a CLIENT-SAFE paymaster URL is configured (an explicit per-chain `paymasterUrl` or a
 * `paymasterProxyUrl` proxy) — never the Pimlico-key fallback, which must never reach a client.
 */
export type GaslessSendCallsBuild = {
  /** The atomic `[approve, transfer]` batch (domain shape: `value` is a bigint). */
  calls: readonly GaslessCall[];
  /** Numeric EVM chain id for `wallet_sendCalls`. */
  chainId: number;
  /** ERC-7677 sponsorship for `wallet_sendCalls`; ABSENT when no client-safe paymaster is configured. */
  paymaster?: { url: string; context?: Record<string, unknown> };
  /** Hub recipient + action payload (mirrors the batch's `transfer` args). */
  relayData: RelayExtraData;
};

/** Inputs for the Mode A (`sendCalls`) execution. */
export type GaslessSendCallsParams = GaslessBatchInput & {
  /** EIP-5792-capable external EVM EOA wallet (MetaMask/Rabby/Coinbase). */
  walletProvider: IGaslessCapableEvmWalletProvider;
};

/** Spoke-side result of a Mode A execution: the tx hash of the atomic batch + relay data. */
export type GaslessSendCallsResult = {
  srcChainTxHash: string;
  relayData: RelayExtraData;
};

/** Whether a Mode A gasless send resolves at runtime for a given chain + wallet. */
export type GaslessWalletMode = 'walletCalls' | 'unsupported';

/** Result of Mode A wallet capability detection — lets a dApp decide whether to offer `sendCalls`. */
export type GaslessWalletCapabilities = {
  chainKey: EvmSpokeOnlyChainKey;
  /** Chain is gasless-configured (EIP-7702 live + endpoints available). */
  configured: boolean;
  /** The wallet advertises EIP-5792 atomic batching. */
  atomicSupported: boolean;
  /** The wallet advertises ERC-7677 paymaster support. */
  paymasterSupported: boolean;
  /** The mode `sendCalls()` would use. `unsupported` → Mode A not possible for this input. */
  resolvedMode: GaslessWalletMode;
};

/** Inputs for Mode A wallet capability detection (does not execute anything). */
export type GaslessWalletCapabilitiesParams = {
  chainKey: EvmSpokeOnlyChainKey;
  walletProvider: IGaslessCapableEvmWalletProvider;
};

/** Inputs for `relay`: complete the hub-delivery tail after an execution-only `submit` / `sendCalls`; the caller invokes it to relay the returned tx hash. */
export type GaslessRelayParams = {
  srcChainKey: EvmSpokeOnlyChainKey;
  srcChainTxHash: string;
  relayData: RelayExtraData;
  /** Relay wait timeout in ms. Defaults to the relay helper's `DEFAULT_RELAY_TX_TIMEOUT`. */
  timeout?: number;
};

/** Result of `relay`: the spoke tx hash + the settled hub (destination) tx hash. */
export type GaslessRelayResult = TxHashPair;
