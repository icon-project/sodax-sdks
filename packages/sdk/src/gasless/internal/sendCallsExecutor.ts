import type { IGaslessCapableEvmWalletProvider } from '@sodax/types';
import type { GaslessCall } from './buildDepositCalls.js';

export type SendCallsExecutorParams = {
  /** EIP-5792-capable external wallet (MetaMask/Rabby/Coinbase). */
  wallet: IGaslessCapableEvmWalletProvider;
  /** The atomic batch — `[approve, transfer]`. */
  calls: readonly GaslessCall[];
  paymasterUrl: string;
  /** Optional paymaster context (e.g. Pimlico `sponsorshipPolicyId`). */
  paymasterContext?: Record<string, unknown>;
  /** Target chain id — the wallet provider rejects if its active chain differs. */
  chainId: number;
};

/** Mode A execution: submit the `[approve, transfer]` batch through the connected wallet via EIP-5792 `wallet_sendCalls` (atomic + ERC-7677 paymaster), then poll `wallet_getCallsStatus`. Returns the confirmed bundle's on-chain tx hash; throws if it does not confirm. */
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
  // `statusCode === 200` is a defensive fallback for wallets that omit the string status.
  const confirmed = status.status === 'success' || status.statusCode === 200;
  const receipt = status.receipts?.at(-1);
  if (!confirmed || !receipt?.transactionHash) {
    throw new Error(`Gasless sendCalls did not confirm (status=${status.status ?? status.statusCode ?? 'unknown'})`);
  }

  return { srcChainTxHash: receipt.transactionHash };
}
