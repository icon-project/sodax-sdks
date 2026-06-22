import type { Address, GetChainType, Hex, IntentRelayChainId, PartnerFee, SpokeChainKey } from '@sodax/types';

export type CreateIntentParams<K extends SpokeChainKey = SpokeChainKey> = {
  inputToken: string;
  outputToken: string;
  inputAmount: bigint;
  minOutputAmount: bigint;
  deadline: bigint;
  allowPartialFill: boolean;
  srcChainKey: K;
  dstChainKey: SpokeChainKey;
  srcAddress: string;
  dstAddress: string;
  solver?: Address; // Optional specific solver address (address(0) = any solver)
  data: Hex;
};

/**
 * Parameters for creating a limit order intent.
 * Makes the `deadline` field optional for limit orders.
 */
export type CreateLimitOrderParams<K extends SpokeChainKey = SpokeChainKey> = Omit<
  CreateIntentParams<K>,
  'deadline'
> & { deadline?: bigint };

// srcPublicKey only matters for Stacks (its `SP…` address can't be derived at raw-tx build time);
// key it off K so non-Stacks actions can't set it.
type SrcPublicKeySlot<K extends SpokeChainKey> =
  GetChainType<K> extends 'STACKS' ? { srcPublicKey?: string } : { srcPublicKey?: never };

/**
 * Per-action extras for swap intent creation, supplied via the `extras` slot of the swap
 * action params.
 */
export type SwapExtras<K extends SpokeChainKey = SpokeChainKey> = {
  /** Overrides the configured swap partner fee for this action; falls back to config when omitted. */
  partnerFee?: PartnerFee;
} & SrcPublicKeySlot<K>;

export type Intent = {
  intentId: bigint;
  creator: Address;
  inputToken: Address;
  outputToken: Address;
  inputAmount: bigint;
  minOutputAmount: bigint;
  deadline: bigint;
  allowPartialFill: boolean;
  srcChain: IntentRelayChainId;
  dstChain: IntentRelayChainId;
  srcAddress: Hex;
  dstAddress: Hex;
  solver: Address;
  data: Hex;
};

export enum IntentDataType {
  FEE = 1,
}

export type FeeData = {
  fee: bigint;
  receiver: Address;
};

export type IntentData = {
  type: IntentDataType;
  data: Hex;
};

export type IntentState = {
  exists: boolean;
  remainingInput: bigint;
  receivedOutput: bigint;
  pendingPayment: boolean;
};
