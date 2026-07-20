import { http, type Address, type Hex, type PublicClient } from 'viem';
import { createBundlerClient, createPaymasterClient, getUserOperationHash } from 'viem/account-abstraction';
import { toSimple7702SmartAccount } from 'viem/account-abstraction';
import type { GaslessCall } from './buildDepositCalls.js';
import { DELEGATION_PREFIX } from './eoa.js';
import { viewOnlyOwner } from './eoaStubAccount.js';
import type { UnsignedUserOp } from './userOpDto.js';

export type PrepareUserOpParams = {
  publicClient: PublicClient;
  sender: Address;
  /** The atomic batch — `[approve, transfer]`. */
  calls: readonly GaslessCall[];
  chainId: number;
  bundlerUrl: string;
  paymasterUrl: string;
  /** Optional ERC-7677 paymaster context (e.g. Pimlico `sponsorshipPolicyId`). */
  paymasterContext?: Record<string, unknown>;
  /** The implementation the EOA is already delegated to (from `classifySender`), if any. */
  delegatedTo?: Address;
};

export type PreparedUserOp = {
  entryPoint: Address;
  /** Fully-built, unsigned UserOperation (bigint fields). */
  userOp: UnsignedUserOp;
  /** The hash the external signer must sign. */
  userOpHash: Hex;
  /** Unsigned EIP-7702 authorization tuple — present only when delegation is still required. */
  authorization?: { chainId: number; address: Address; nonce: number };
};

/** Build the `[approve, transfer]` batch as an unsigned, keyless ERC-4337 (EIP-7702, EntryPoint v0.8) UserOp: viem fixes paymaster sponsorship + estimates gas; the 7702 authorization is excluded from populated params (signing needs the key) and returned unsigned, with a `stateOverride` designator so gas is estimated against the delegated account; the stub `signature` makes the op hashable. */
export async function prepareUserOp(params: PrepareUserOpParams): Promise<PreparedUserOp> {
  const { publicClient, sender, calls, chainId, bundlerUrl, paymasterUrl, paymasterContext, delegatedTo } = params;

  const account = await toSimple7702SmartAccount({ client: publicClient, owner: viewOnlyOwner(sender) });
  const paymaster = createPaymasterClient({ transport: http(paymasterUrl) });
  const bundlerClient = createBundlerClient({
    account,
    client: publicClient,
    transport: http(bundlerUrl),
    paymaster,
    ...(paymasterContext ? { paymasterContext } : {}),
  });

  const delegateAddress = account.authorization?.address;
  if (delegateAddress === undefined) {
    throw new Error('Simple7702 account did not expose an EIP-7702 authorization delegate address');
  }
  const alreadyDelegated = delegatedTo !== undefined && delegatedTo.toLowerCase() === delegateAddress.toLowerCase();
  const designator = `${DELEGATION_PREFIX}${delegateAddress.slice(2)}` as Hex;

  const userOp = await bundlerClient.prepareUserOperation({
    account,
    calls: [...calls],
    // Keyless: populate everything except the 7702 authorization (signing it needs the key).
    parameters: ['factory', 'nonce', 'gas', 'fees', 'paymaster', 'signature'],
    // Simulate against the delegated account when the EOA is not yet delegated.
    ...(alreadyDelegated ? {} : { stateOverride: [{ address: sender, code: designator }] }),
  });

  const entryPoint = account.entryPoint.address;
  const userOpHash = getUserOperationHash({
    chainId,
    entryPointAddress: entryPoint,
    entryPointVersion: account.entryPoint.version,
    userOperation: userOp,
  });

  const authorization = alreadyDelegated
    ? undefined
    : { chainId, address: delegateAddress, nonce: await publicClient.getTransactionCount({ address: sender }) };

  return { entryPoint, userOp, userOpHash, authorization };
}
