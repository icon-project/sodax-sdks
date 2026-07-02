// Valibot response schemas for the backend Swaps API v2.
//
// One schema per response shape declared in `@sodax/types`'s `backendApiV2.ts`.
// `SwapsApiService` validates every HTTP response against these before returning
// it, so a backend contract drift surfaces as a `Result` error rather than an
// untyped runtime surprise.
//
// Schemas are intentionally NOT pinned with `v.GenericSchema<…V2>`: that forces
// the schema's INPUT type to equal the (readonly) `…V2` type, which trips on
// covariance for `v.record`/`v.array`. Type fidelity is instead enforced where
// each schema is consumed — `SwapsApiService` methods declare their return as
// `Promise<Result<…V2>>`, so a schema whose inferred output drifts from the
// canonical type is a compile error at the call site.
//
// All bigint-derived fields arrive as decimal strings and all `Date` fields as
// ISO strings on the wire, so every such field is `v.string()`. The unsigned `tx`
// payload is validated and transformed back to its `RawTxReturnType` domain variant
// by `rawTxSchemas.ts` (selected per source chain key); the response schemas that
// carry it are exposed as `make*ResponseSchema(txSchema)` factories. The remaining
// opaque payloads (`gas`, relay `result`) are still `v.unknown()`.

import * as v from 'valibot';
import type { RawTxReturnType } from '@sodax/types';

/** A supported swap token descriptor (`SwapTokenV2`). */
export const SwapTokenSchema = v.object({
  symbol: v.string(),
  name: v.string(),
  decimals: v.number(),
  address: v.string(),
  chainKey: v.string(),
  hubAsset: v.string(),
  vault: v.string(),
});

/** Intent struct returned by the server (`IntentResponseV2`) — bigint fields are decimal strings. */
export const IntentResponseSchema = v.object({
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

/** Relay extra-data payload (`RelayExtraDataResponseV2` / `IntentExtraDataResponseV2`). */
export const RelayExtraDataResponseSchema = v.object({
  address: v.string(),
  payload: v.string(),
});

/**
 * Unsigned create-intent tx + built intent + relay payload (`CreateIntentResponseV2` /
 * `CreateLimitOrderResponseV2`). Parameterized by the chain-specific `tx` schema (see
 * `rawTxSchemaForChainKey`) so `tx` is validated and transformed to its domain variant.
 */
export const makeCreateIntentResponseSchema = (txSchema: v.GenericSchema<unknown, RawTxReturnType>) =>
  v.object({
    tx: txSchema,
    intent: IntentResponseSchema,
    relayData: RelayExtraDataResponseSchema,
  });

/** GET /swaps/tokens (`GetSwapTokensResponseV2`). */
export const GetSwapTokensResponseSchema = v.record(v.string(), v.array(SwapTokenSchema));

/** GET /swaps/tokens/:chainKey (`GetSwapTokensByChainResponseV2`). */
export const GetSwapTokensByChainResponseSchema = v.array(SwapTokenSchema);

/** POST /swaps/quote (`QuoteResponseV2`). `txData` (present only when `includeTxData=true`) carries the unsigned tx. */
export const makeQuoteResponseSchema = (txSchema: v.GenericSchema<unknown, RawTxReturnType>) =>
  v.object({
    quotedAmount: v.string(),
    txData: v.optional(makeCreateIntentResponseSchema(txSchema)),
  });

/** GET /swaps/deadline (`DeadlineResponseV2`). */
export const DeadlineResponseSchema = v.object({
  deadline: v.string(),
});

/** POST /swaps/allowance/check (`AllowanceCheckResponseV2`). */
export const AllowanceCheckResponseSchema = v.object({
  valid: v.boolean(),
});

/** POST /swaps/approve (`ApproveResponseV2`). */
export const makeApproveResponseSchema = (txSchema: v.GenericSchema<unknown, RawTxReturnType>) =>
  v.object({ tx: txSchema });

/** POST /swaps/intents/submit (`SubmitIntentResponseV2`). */
export const SubmitIntentResponseSchema = v.object({
  result: v.unknown(),
});

/** POST /swaps/intents/status (`StatusResponseV2`). Status: -1 NOT_FOUND, 1 NOT_STARTED, 2 STARTED, 3 SOLVED, 4 FAILED. */
export const StatusResponseSchema = v.object({
  status: v.picklist([-1, 1, 2, 3, 4]),
  fillTxHash: v.optional(v.string()),
});

/** POST /swaps/intents/cancel (`CancelIntentResponseV2`). */
export const makeCancelIntentResponseSchema = (txSchema: v.GenericSchema<unknown, RawTxReturnType>) =>
  v.object({ tx: txSchema });

/** POST /swaps/intents/hash (`IntentHashResponseV2`). */
export const IntentHashResponseSchema = v.object({
  hash: v.string(),
});

/** POST /swaps/intents/packet (`IntentPacketResponseV2`). */
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

/** GET /swaps/intents/:txHash/fill (`IntentStateV2`). */
export const IntentStateResponseSchema = v.object({
  exists: v.boolean(),
  remainingInput: v.string(),
  receivedOutput: v.string(),
  pendingPayment: v.boolean(),
});

/** POST /swaps/gas/estimate (`GasEstimateResponseV2`). */
export const GasEstimateResponseSchema = v.object({
  gas: v.unknown(),
});

/** GET /swaps/fees/partner · GET /swaps/fees/solver (`FeeResponseV2`). */
export const FeeResponseSchema = v.object({
  fee: v.string(),
});

/** POST /swaps/submit-tx (`SubmitTxResponseV2`). */
export const SubmitTxResponseSchema = v.object({
  success: v.boolean(),
  data: v.object({
    status: v.picklist(['inserted', 'duplicate']),
    message: v.string(),
  }),
});

/** Lifecycle status of a submitted swap tx (`SubmitSwapTxStatusV2`). */
const SubmitSwapTxStatusSchema = v.picklist([
  'pending',
  'relaying',
  'relayed',
  'posting_execution',
  'executed',
  'failed',
]);

/** Relay packet data attached to a submit-tx result (`PacketDataV2`, snake_case as stored). */
const PacketDataSchema = v.object({
  src_chain_id: v.number(),
  src_tx_hash: v.string(),
  src_address: v.string(),
  status: v.picklist(['pending', 'validating', 'executing', 'executed']),
  dst_chain_id: v.number(),
  conn_sn: v.number(),
  dst_address: v.string(),
  dst_tx_hash: v.string(),
  signatures: v.array(v.string()),
  payload: v.string(),
});

/** Processing result for a submitted swap tx, present when executed (`SubmitTxStatusResultV2`). */
const SubmitTxStatusResultSchema = v.object({
  dstIntentTxHash: v.string(),
  packetData: v.optional(PacketDataSchema),
  intent_hash: v.optional(v.string()),
});

/** Processing state of a submitted swap tx (`SubmitTxStatusDataV2`). */
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

/** GET /swaps/submit-tx/status (`SubmitTxStatusResponseV2`). */
export const SubmitTxStatusResponseSchema = v.object({
  success: v.boolean(),
  data: SubmitTxStatusDataSchema,
});
