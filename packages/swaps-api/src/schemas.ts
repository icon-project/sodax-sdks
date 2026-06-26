import type {
  AllowanceCheckResponseV2,
  ApproveResponseV2,
  CancelIntentResponseV2,
  CreateIntentResponseV2,
  CreateLimitOrderResponseV2,
  DeadlineResponseV2,
  FeeResponseV2,
  GasEstimateResponseV2,
  GetIntentResponseV2,
  GetSwapTokensByChainResponseV2,
  GetSwapTokensResponseV2,
  IntentExtraDataResponseV2,
  IntentHashResponseV2,
  IntentPacketResponseV2,
  IntentResponseV2,
  IntentStateV2,
  QuoteResponseV2,
  RelayExtraDataResponseV2,
  StatusResponseV2,
  SubmitIntentResponseV2,
  SubmitTxResponseV2,
  SubmitTxStatusResponseV2,
  SwapTokenV2,
} from '@sodax/types';
import * as v from 'valibot';

// Response schemas mirror `packages/types/src/backend/backendApiV2.ts`. `v.object` tolerates additive
// backend fields (extra keys are ignored, not rejected) while inferring the exact contract shape, so
// the drift guards at the bottom of this file stay strict. Opaque chain payloads (`tx`, `gas`,
// `result`) are `v.unknown()` per the contract. These schemas are internal — not part of the public API.

// ── Shared building blocks ────────────────────────────────────────────

const SwapTokenSchema = v.object({
  symbol: v.string(),
  name: v.string(),
  decimals: v.number(),
  address: v.string(),
  chainKey: v.string(),
  hubAsset: v.string(),
  vault: v.string(),
});

const IntentResponseSchema = v.object({
  intentId: v.string(),
  creator: v.string(),
  inputToken: v.string(),
  outputToken: v.string(),
  inputAmount: v.string(),
  minOutputAmount: v.string(),
  deadline: v.string(),
  allowPartialFill: v.boolean(),
  srcChain: v.string(),
  dstChain: v.string(),
  srcAddress: v.string(),
  dstAddress: v.string(),
  solver: v.string(),
  data: v.string(),
});

const RelayExtraDataResponseSchema = v.object({
  address: v.string(),
  payload: v.string(),
});

export const CreateIntentResponseSchema = v.object({
  tx: v.unknown(),
  intent: IntentResponseSchema,
  relayData: RelayExtraDataResponseSchema,
});

// ── Per-endpoint response schemas ─────────────────────────────────────

export const GetSwapTokensResponseSchema = v.record(v.string(), v.array(SwapTokenSchema));
export const GetSwapTokensByChainResponseSchema = v.array(SwapTokenSchema);

export const QuoteResponseSchema = v.object({
  quotedAmount: v.string(),
  txData: v.optional(CreateIntentResponseSchema),
});

export const DeadlineResponseSchema = v.object({ deadline: v.string() });

export const AllowanceCheckResponseSchema = v.object({ valid: v.boolean() });

export const ApproveResponseSchema = v.object({ tx: v.unknown() });

export const SubmitIntentResponseSchema = v.object({ result: v.unknown() });

export const StatusResponseSchema = v.object({
  status: v.picklist([-1, 1, 2, 3, 4]),
  fillTxHash: v.optional(v.string()),
});

export const CancelIntentResponseSchema = v.object({ tx: v.unknown() });

export const IntentHashResponseSchema = v.object({ hash: v.string() });

export const IntentPacketResponseSchema = v.object({
  srcChainId: v.number(),
  srcTxHash: v.string(),
  srcAddress: v.string(),
  status: v.string(),
  dstChainId: v.number(),
  connSn: v.number(),
  dstAddress: v.string(),
  dstTxHash: v.string(),
  signatures: v.array(v.string()),
  payload: v.string(),
});

export const IntentExtraDataResponseSchema = RelayExtraDataResponseSchema;

export const IntentStateSchema = v.object({
  exists: v.boolean(),
  remainingInput: v.string(),
  receivedOutput: v.string(),
  pendingPayment: v.boolean(),
});

export const GetIntentResponseSchema = IntentResponseSchema;

export const CreateLimitOrderResponseSchema = CreateIntentResponseSchema;

export const GasEstimateResponseSchema = v.object({ gas: v.unknown() });

export const FeeResponseSchema = v.object({ fee: v.string() });

const SubmitTxResponseDataSchema = v.object({
  status: v.picklist(['inserted', 'duplicate']),
  message: v.string(),
});

export const SubmitTxResponseSchema = v.object({
  success: v.boolean(),
  data: SubmitTxResponseDataSchema,
});

const PacketDataStatusSchema = v.picklist(['pending', 'validating', 'executing', 'executed']);
const SubmitSwapTxStatusSchema = v.picklist([
  'pending',
  'relaying',
  'relayed',
  'posting_execution',
  'executed',
  'failed',
]);

const PacketDataSchema = v.object({
  src_chain_id: v.number(),
  src_tx_hash: v.string(),
  src_address: v.string(),
  status: PacketDataStatusSchema,
  dst_chain_id: v.number(),
  conn_sn: v.number(),
  dst_address: v.string(),
  dst_tx_hash: v.string(),
  signatures: v.array(v.string()),
  payload: v.string(),
});

const SubmitTxStatusResultSchema = v.object({
  dstIntentTxHash: v.string(),
  packetData: v.optional(PacketDataSchema),
  intent_hash: v.optional(v.string()),
});

const SubmitTxStatusDataSchema = v.object({
  txHash: v.string(),
  srcChainKey: v.string(),
  status: SubmitSwapTxStatusSchema,
  failedAtStep: v.optional(SubmitSwapTxStatusSchema),
  failureReason: v.optional(v.string()),
  processingAttempts: v.number(),
  abandonedAt: v.optional(v.string()),
  result: v.optional(SubmitTxStatusResultSchema),
  userMessage: v.optional(v.string()),
  intentCancelled: v.optional(v.boolean()),
});

export const SubmitTxStatusResponseSchema = v.object({
  success: v.boolean(),
  data: SubmitTxStatusDataSchema,
});

// ── Compile-time drift guards ─────────────────────────────────────────
// Each entry fails `tsc` if a schema's inferred output stops matching its contract type. `Equal` is
// strict; `Extends` is one-way for the `readonly` array/record responses (a mutable array is a valid
// runtime value for a `readonly` field, and the element type is strictly guarded via SwapTokenV2).

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type Expect<T extends true> = T;

export type SchemaDriftGuards = [
  Expect<Equal<v.InferOutput<typeof SwapTokenSchema>, SwapTokenV2>>,
  Expect<Equal<v.InferOutput<typeof IntentResponseSchema>, IntentResponseV2>>,
  Expect<Equal<v.InferOutput<typeof RelayExtraDataResponseSchema>, RelayExtraDataResponseV2>>,
  Expect<Equal<v.InferOutput<typeof CreateIntentResponseSchema>, CreateIntentResponseV2>>,
  Expect<Extends<v.InferOutput<typeof GetSwapTokensResponseSchema>, GetSwapTokensResponseV2>>,
  Expect<Extends<v.InferOutput<typeof GetSwapTokensByChainResponseSchema>, GetSwapTokensByChainResponseV2>>,
  Expect<Equal<v.InferOutput<typeof QuoteResponseSchema>, QuoteResponseV2>>,
  Expect<Equal<v.InferOutput<typeof DeadlineResponseSchema>, DeadlineResponseV2>>,
  Expect<Equal<v.InferOutput<typeof AllowanceCheckResponseSchema>, AllowanceCheckResponseV2>>,
  Expect<Equal<v.InferOutput<typeof ApproveResponseSchema>, ApproveResponseV2>>,
  Expect<Equal<v.InferOutput<typeof SubmitIntentResponseSchema>, SubmitIntentResponseV2>>,
  Expect<Equal<v.InferOutput<typeof StatusResponseSchema>, StatusResponseV2>>,
  Expect<Equal<v.InferOutput<typeof CancelIntentResponseSchema>, CancelIntentResponseV2>>,
  Expect<Equal<v.InferOutput<typeof IntentHashResponseSchema>, IntentHashResponseV2>>,
  Expect<Equal<v.InferOutput<typeof IntentPacketResponseSchema>, IntentPacketResponseV2>>,
  Expect<Equal<v.InferOutput<typeof IntentExtraDataResponseSchema>, IntentExtraDataResponseV2>>,
  Expect<Equal<v.InferOutput<typeof IntentStateSchema>, IntentStateV2>>,
  Expect<Equal<v.InferOutput<typeof GetIntentResponseSchema>, GetIntentResponseV2>>,
  Expect<Equal<v.InferOutput<typeof CreateLimitOrderResponseSchema>, CreateLimitOrderResponseV2>>,
  Expect<Equal<v.InferOutput<typeof GasEstimateResponseSchema>, GasEstimateResponseV2>>,
  Expect<Equal<v.InferOutput<typeof FeeResponseSchema>, FeeResponseV2>>,
  Expect<Equal<v.InferOutput<typeof SubmitTxResponseSchema>, SubmitTxResponseV2>>,
  Expect<Equal<v.InferOutput<typeof SubmitTxStatusResponseSchema>, SubmitTxStatusResponseV2>>,
];
