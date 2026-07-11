import type { IGaslessCapableEvmWalletProvider } from '@sodax/types';
import type { GaslessCall } from './buildDepositCalls.js';

export type SendCallsExecutorParams = {
  /** EIP-5792-capable external wallet (MetaMask/Rabby/Coinbase). */
  wallet: IGaslessCapableEvmWalletProvider;
  /** The atomic batch — `[approve, transfer]`. */
  calls: readonly GaslessCall[];
  /** ERC-7677 paymaster endpoint (sponsors the gas). */
  paymasterUrl: string;
  /** Optional paymaster context (e.g. Pimlico `sponsorshipPolicyId`). */
  paymasterContext?: Record<string, unknown>;
  /** Target chain id — the wallet provider rejects if its active chain differs. */
  chainId: number;
};

/**
 * Mode A execution: submit the batched `[approve, transfer]` through the connected wallet via
 * EIP-5792 `wallet_sendCalls`, requesting atomic execution and ERC-7677 paymaster sponsorship, then
 * poll `wallet_getCallsStatus` for the on-chain tx hash.
 *
 * @returns the on-chain transaction hash of the confirmed bundle, for relay submission.
 * @throws if the bundle does not confirm (never returns a hash for a partial/failed batch).
 */
export async function executeSendCalls(params: SendCallsExecutorParams): Promise<{ srcChainTxHash: string }> {
  const { wallet, calls, paymasterUrl, paymasterContext, chainId } = params;

  const { id } = await wallet.sendCalls({
    calls: [...calls],
    chainId,
    capabilities: {
      paymasterService: { url: paymasterUrl, ...(paymasterContext ? { context: paymasterContext } : {}) },
      atomic: { status: 'required' },
    },
  });

  const status = await wallet.waitForCallsStatus(id);
  // Confirmed on the string status; `statusCode === 200` is a defensive fallback for wallets that
  // omit the string field. A reverted batch reports 'failure' / 500 and is rejected below.
  const confirmed = status.status === 'success' || status.statusCode === 200;
  const receipt = status.receipts?.at(-1);
  if (!confirmed || !receipt?.transactionHash) {
    throw new Error(`Gasless sendCalls did not confirm (status=${status.status ?? status.statusCode ?? 'unknown'})`);
  }

  return { srcChainTxHash: receipt.transactionHash };
}
