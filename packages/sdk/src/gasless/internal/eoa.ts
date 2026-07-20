import type { Address, PublicClient } from 'viem';

/** EIP-7702 delegation designator prefix: a delegated EOA's code is `0xef0100 ‖ <20-byte delegate>`, so the first 8 chars mark it. Shared with `prepareUserOp` so the detect and build sides can't diverge. */
export const DELEGATION_PREFIX = '0xef0100';

export type SenderClassification = {
  /** True when `srcAddress` is a usable EOA: no code, or an EIP-7702 delegation designator. */
  isEoa: boolean;
  /** For a delegated EOA, the implementation it currently delegates to (lower-cased). */
  delegatedTo?: Address;
};

/** Classify a spoke-chain address by its code: empty or an `0xef0100…` designator → EOA (delegated or not); any other code → deployed contract, not an eligible gasless sender. */
export async function classifySender(publicClient: PublicClient, address: Address): Promise<SenderClassification> {
  const code = await publicClient.getCode({ address });
  if (!code || code === '0x') return { isEoa: true };
  if (code.slice(0, 8).toLowerCase() === DELEGATION_PREFIX) {
    return { isEoa: true, delegatedTo: `0x${code.slice(8)}`.toLowerCase() as Address };
  }
  return { isEoa: false };
}
