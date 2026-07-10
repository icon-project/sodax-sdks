import { http, type PrivateKeyAccount, type PublicClient } from 'viem';
import { createBundlerClient, createPaymasterClient, toSimple7702SmartAccount } from 'viem/account-abstraction';
import type { GaslessCall } from './buildDepositCalls.js';

export type UserOpExecutorParams = {
  /** Public client for the spoke chain (from `spoke.evm.getPublicClient(chainKey)`). */
  publicClient: PublicClient;
  /** EOA owner. Delegated to the Simple7702 implementation for this batch. */
  owner: PrivateKeyAccount;
  /** The atomic batch — `[approve, transfer]`. */
  calls: readonly GaslessCall[];
  /** Pimlico ERC-4337 bundler endpoint. */
  bundlerUrl: string;
  /** Pimlico ERC-7677 paymaster endpoint (sponsors the gas). */
  paymasterUrl: string;
};

/**
 * Mode B execution: run the batched `[approve, transfer]` as a single sponsored ERC-4337 user
 * operation through a viem Simple7702 smart account.
 *
 * viem's `prepareUserOperation` handles the EIP-7702 authorization automatically — it signs and
 * attaches `account.authorization` only when the EOA is not already delegated — so no manual
 * `getCode` / nonce handling is needed here.
 *
 * @returns the on-chain transaction hash of the executed user operation, for relay submission.
 * @throws if the user operation reverts on-chain.
 */
export async function executeUserOp(params: UserOpExecutorParams): Promise<{ srcChainTxHash: string }> {
  const { publicClient, owner, calls, bundlerUrl, paymasterUrl } = params;

  const account = await toSimple7702SmartAccount({ client: publicClient, owner });
  const paymaster = createPaymasterClient({ transport: http(paymasterUrl) });
  const bundlerClient = createBundlerClient({
    account,
    client: publicClient,
    transport: http(bundlerUrl),
    paymaster,
  });

  const hash = await bundlerClient.sendUserOperation({ calls });
  const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });

  if (!receipt.success) {
    throw new Error('Gasless user operation reverted on-chain');
  }

  return { srcChainTxHash: receipt.receipt.transactionHash };
}
