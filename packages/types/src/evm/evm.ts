import type { Address, Hex, Hash } from '../shared/shared.js';
import type { ICoreWallet } from '../wallet/wallet.js';

export type EvmReturnType<Raw extends boolean> = Raw extends true
  ? EvmRawTransaction
  : Raw extends false
    ? Hex
    : Hex | EvmRawTransaction;

export type EvmRawTransaction = {
  from: Address;
  to: Address;
  value: bigint;
  data: Hex;
};

export type EvmContractCall = {
  address: Address; // Target address of the call
  value: bigint; // Ether value to send (in wei as a string for precision)
  data: Hex; // Calldata for the call
};

// Ethereum JSON-RPC Spec based logs
export type EvmRawLog = {
  address: Address;
  topics: [Hex, ...Hex[]] | [];
  data: Hex;
  blockHash: Hash | null;
  blockNumber: Address | null;
  logIndex: Hex | null;
  transactionHash: Hash | null;
  transactionIndex: Hex | null;
  removed: boolean;
};

// Ethereum JSON-RPC Spec based transaction receipt
export type EvmRawTransactionReceipt = {
  transactionHash: string; // 32-byte hash
  transactionIndex: string; // hex string, e.g., '0x1'
  blockHash: string; // 32-byte hash
  blockNumber: string; // hex string, e.g., '0x5BAD55'
  from: string; // 20-byte address
  to: string | null; // null if contract creation
  cumulativeGasUsed: string; // hex string
  gasUsed: string; // hex string
  contractAddress: string | null; // non-null only if contract creation
  logs: EvmRawLog[];
  logsBloom: string; // 256-byte bloom filter hex string
  status?: string; // '0x1' = success, '0x0' = failure (optional pre-Byzantium)
  type?: string; // '0x0', '0x1', or '0x2' for tx type
  effectiveGasPrice?: string; // hex string, only on EIP-1559 txs
};

export interface IEvmWalletProvider extends ICoreWallet {
  readonly chainType: 'EVM';
  getWalletAddress: () => Promise<Address>;
  sendTransaction: (evmRawTx: EvmRawTransaction) => Promise<Hash>;
  waitForTransactionReceipt: (txHash: Hash) => Promise<EvmRawTransactionReceipt>;
}

// ─────────────────────────────────────────────────────────────────────────────
// EIP-5792 (`wallet_sendCalls`) + ERC-7677 paymaster capability surface.
//
// Local, viem-free shapes (mirroring EvmRawTransaction/EvmRawTransactionReceipt) so `@sodax/types`
// keeps its zero-third-party-type rule. Used by the OPTIONAL {@link IGaslessCapableEvmWalletProvider}
// sub-interface for external wallets (MetaMask/Rabby/Coinbase) that can batch calls atomically and
// accept a sponsoring paymaster — the base {@link IEvmWalletProvider} stays unchanged.
// ─────────────────────────────────────────────────────────────────────────────

/** A single call in an EIP-5792 batch (viem `Call` shape). */
export type EvmBatchCall = { to: Address; data: Hex; value?: bigint };

/** Capabilities passed to `wallet_sendCalls` (ERC-7677 paymaster + EIP-5792 atomic). Open for wallet-specific keys. */
export type EvmSendCallsCapabilities = {
  paymasterService?: { url: string; context?: Record<string, unknown> };
  atomic?: { status?: string };
  [capability: string]: unknown;
};

/** Response of `wallet_getCapabilities` for a chain — an opaque per-EIP-5792 map read defensively by callers. */
export type EvmWalletCapabilities = Record<string, unknown>;

/** Result of `wallet_sendCalls`: a bundle identifier (not a tx hash — poll {@link EvmCallsStatus} for that). */
export type EvmSendCallsResult = { id: string; capabilities?: Record<string, unknown> };

/** Status + receipts of a call bundle, from `wallet_getCallsStatus` / viem `waitForCallsStatus`. */
export type EvmCallsStatus = {
  status?: string; // viem: 'pending' | 'success' | 'failure'
  statusCode?: number; // EIP-5792 numeric status (e.g. 200 = confirmed)
  atomic?: boolean;
  receipts?: { transactionHash: Hash }[];
};

/**
 * Optional EIP-5792 capability surface for EVM wallets that can batch calls atomically and accept an
 * ERC-7677 paymaster. Implemented by browser-extension wallet providers (e.g. `EvmWalletProvider` in
 * browser mode). Kept as a sub-interface so non-5792 wallets and the base contract are unaffected;
 * consumers narrow via a runtime guard before using it.
 */
export interface IGaslessCapableEvmWalletProvider extends IEvmWalletProvider {
  getCapabilities: (chainId: number) => Promise<EvmWalletCapabilities>;
  sendCalls: (params: {
    calls: EvmBatchCall[];
    capabilities?: EvmSendCallsCapabilities;
    /** Expected chain id. The provider rejects if the wallet's active chain differs (prevents wrong-chain submits). */
    chainId?: number;
  }) => Promise<EvmSendCallsResult>;
  waitForCallsStatus: (id: string) => Promise<EvmCallsStatus>;
}
