// Valibot response schemas for the gasless-SWAP API HTTP bodies (`/gasless-swap/*`), so backend contract
// drift surfaces as a Result error. Reuses the gasless response schemas (gaslessApiSchemas.ts) and
// re-derives the JSON-safe swap wire shapes locally rather than widening @sodax/swaps-api's internal
// schema surface. The re-derived shapes are pinned to their @sodax/types contracts by the strict Equal
// drift guards at the bottom (a covariance-only method-return-type check would let an added optional field
// drift silently, since v.object strips unknown keys at runtime).

import type {
  IntentResponseV2,
  RelayExtraDataResponseV2,
  SubmitTxResponseV2,
  SubmitTxStatusResponseV2,
} from '@sodax/types';
import * as v from 'valibot';

import { GaslessPrepareResponseSchema } from './gaslessApiSchemas.js';

// ── JSON-safe swap wire shapes (mirror @sodax/swaps-api's internal, drift-guarded schemas) ──

/** All-string swap intent (`IntentResponseV2`). */
const IntentResponseV2Schema = v.object({
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

/** `{ address, payload }` relay extra data (`RelayExtraDataResponseV2`). */
const RelayExtraDataResponseV2Schema = v.object({
  address: v.string(),
  payload: v.string(),
});

const SubmitSwapTxStatusSchema = v.picklist([
  'pending',
  'relaying',
  'relayed',
  'posting_execution',
  'posted_execution',
  'solved',
  'failed',
]);

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

/** Submit-tx ack (`SubmitTxResponseV2`) — the completeSwap acceptance envelope. */
export const SubmitTxResponseV2Schema = v.object({
  success: v.boolean(),
  data: v.object({
    status: v.picklist(['inserted', 'duplicate']),
    message: v.string(),
  }),
});

/** Completion status envelope (`SubmitTxStatusResponseV2`). */
export const SubmitTxStatusResponseV2Schema = v.object({
  success: v.boolean(),
  data: SubmitTxStatusDataSchema,
});

// ── Gasless-swap composite response schemas ──

/** `prepareSwap` (Mode B): prepared UserOp + built intent + relay data. */
export const GaslessSwapPrepareResponseSchema = v.object({
  prepared: GaslessPrepareResponseSchema,
  intent: IntentResponseV2Schema,
  relayData: RelayExtraDataResponseV2Schema,
});

// ── Compile-time drift guards ──
// Pin each re-derived schema to its @sodax/types contract with a strict Equal, so an added/renamed/retyped
// field fails `tsc` HERE (forcing an update) instead of silently drifting. Mirrors @sodax/swaps-api's
// internal SchemaDriftGuards, which the (unexported) originals carry and this local copy would otherwise lose.
type _Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type _Expect<T extends true> = T;

/** @public Compile-time only. Each entry fails `tsc` if a schema drifts from its contract type.
 *  Intentionally exported — un-exporting trips TS6196 (declared but never used). */
export type _SchemaDriftGuards = [
  _Expect<_Equal<v.InferOutput<typeof IntentResponseV2Schema>, IntentResponseV2>>,
  _Expect<_Equal<v.InferOutput<typeof RelayExtraDataResponseV2Schema>, RelayExtraDataResponseV2>>,
  _Expect<_Equal<v.InferOutput<typeof SubmitTxResponseV2Schema>, SubmitTxResponseV2>>,
  _Expect<_Equal<v.InferOutput<typeof SubmitTxStatusResponseV2Schema>, SubmitTxStatusResponseV2>>,
];

/** `buildSwapCalls` (Mode A): the encoded EIP-5792 `[approve, transfer]` batch + capabilities + built intent + relay data. */
export const GaslessSwapBuildCallsResponseSchema = v.object({
  calls: v.array(v.object({ to: v.string(), data: v.string(), value: v.string() })),
  capabilities: v.object({
    chainId: v.number(),
    atomic: v.object({ status: v.literal('required') }),
    paymasterService: v.optional(
      v.object({ url: v.string(), context: v.optional(v.record(v.string(), v.unknown())) }),
    ),
  }),
  intent: IntentResponseV2Schema,
  relayData: RelayExtraDataResponseV2Schema,
});
