import type { Address, Hex, IntentRelayChainId, PartnerFee, SpokeChainKey } from '@sodax/types';
import type { AccessTokenSlot, SrcPublicKeySlot } from './spoke-types.js';

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

/**
 * Per-action extras for swap intent creation, supplied via the `extras` slot of the swap action
 * params. Reuses the chain-gated {@link SrcPublicKeySlot} / {@link AccessTokenSlot} from the deposit
 * layer so the public gate and the internal `DepositParams` gate are the same type (a generic-K
 * unwrap in `SwapService.createIntent` needs no cast).
 */
export type SwapExtras<K extends SpokeChainKey = SpokeChainKey> = {
  /** Overrides the configured swap partner fee for this action; falls back to config when omitted. */
  partnerFee?: PartnerFee;
} & SrcPublicKeySlot<K> &
  AccessTokenSlot<K>;

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
