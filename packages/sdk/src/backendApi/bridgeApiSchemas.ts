// Valibot response schemas for the backend Bridge API v2.
//
// One schema per response shape declared in `@sodax/types`'s `backendBridgeApiV2.ts`.
// `BridgeApiService` validates every HTTP response against these before returning it,
// so a backend contract drift surfaces as a `Result` error rather than an untyped
// runtime surprise. The relay-envelope schema is declared locally below (the swaps client
// moved to the standalone `@sodax/swaps-api` package, so its schemas are no longer shared here).
//
// Bridge deltas vs swaps:
//   - create-intent response is `{ tx, relayData }` (NO `intent`).
//   - submit-tx-status `status` is TOLERANT (`v.string()`, not a picklist) so a future
//     backend lifecycle state never breaks parse; the SDK relies on an inline terminal
//     check (`status === 'executed' | 'failed'`) instead.
//   - submit-tx-status `result` has NO `intent_hash` (no solver).
//
// As in swaps, schemas are intentionally NOT pinned with `v.GenericSchema<…V2>`; type
// fidelity is enforced where each schema is consumed — `BridgeApiService` methods
// declare their return as `Promise<Result<…V2>>`, so a drift is a compile error there.

import * as v from 'valibot';
import type { RawTxReturnType } from '@sodax/types';

/**
 * Relay envelope (`{ address, payload }`) attached to the create-intent response. Declared locally
 * because the bridge is the sole remaining consumer after the swaps client moved to `@sodax/swaps-api`.
 */
const RelayExtraDataResponseSchema = v.object({
  address: v.string(),
  payload: v.string(),
});

/** A supported bridge token descriptor (`BridgeTokenV2`). */
export const BridgeTokenSchema = v.object({
  symbol: v.string(),
  name: v.string(),
  decimals: v.number(),
  address: v.string(),
  chainKey: v.string(),
  hubAsset: v.string(),
  vault: v.string(),
});

/** GET /bridge/tokens (`GetBridgeTokensResponseV2`). */
export const BridgeTokensResponseSchema = v.record(v.string(), v.array(BridgeTokenSchema));

/** GET /bridge/tokens/:chainKey (`GetBridgeTokensByChainResponseV2`). */
export const BridgeTokensByChainResponseSchema = v.array(BridgeTokenSchema);

/** POST /bridge/allowance/check (`BridgeAllowanceCheckResponseV2`). */
export const BridgeAllowanceCheckResponseSchema = v.object({
  valid: v.boolean(),
});

/**
 * POST /bridge/approve (`BridgeApproveResponseV2`). Parameterized by the chain-specific
 * `tx` schema (see `rawTxSchemaForChainKey`) so `tx` is validated and transformed to its
 * domain variant.
 */
export const makeBridgeApproveResponseSchema = (txSchema: v.GenericSchema<unknown, RawTxReturnType>) =>
  v.object({ tx: txSchema });

/**
 * POST /bridge/intents (`CreateBridgeIntentResponseV2`). `{ tx, relayData }` — no `intent`
 * struct (bridge is vault-backed, not solver-based). Reuses the swaps relay-envelope schema.
 */
export const makeCreateBridgeIntentResponseSchema = (txSchema: v.GenericSchema<unknown, RawTxReturnType>) =>
  v.object({
    tx: txSchema,
    relayData: RelayExtraDataResponseSchema,
  });

/** POST /bridge/submit-tx (`BridgeSubmitTxResponseV2`). */
export const BridgeSubmitTxResponseSchema = v.object({
  success: v.boolean(),
  data: v.object({
    status: v.picklist(['inserted', 'duplicate']),
    message: v.string(),
  }),
});

/** Relay packet data attached to a submit-tx result (`PacketDataV2`, snake_case as stored). */
const BridgePacketDataSchema = v.object({
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

/** Processing result for a submitted bridge tx, present when executed (`BridgeSubmitTxStatusResultV2`). No `intent_hash`. */
const BridgeSubmitTxStatusResultSchema = v.object({
  dstIntentTxHash: v.string(),
  packetData: v.optional(BridgePacketDataSchema),
});

/**
 * Processing state of a submitted bridge tx (`BridgeSubmitTxStatusDataV2`). `status` /
 * `failedAtStep` are tolerant `v.string()` so an unknown backend lifecycle state never breaks
 * parse; `v.object` ignores unexpected extra keys for the same reason.
 */
const BridgeSubmitTxStatusDataSchema = v.object({
  txHash: v.string(),
  srcChainKey: v.string(),
  status: v.string(),
  failedAtStep: v.optional(v.string()),
  failureReason: v.optional(v.string()),
  processingAttempts: v.number(),
  abandonedAt: v.optional(v.string()),
  result: v.optional(BridgeSubmitTxStatusResultSchema),
  userMessage: v.optional(v.string()),
});

/** GET /bridge/submit-tx/status (`BridgeSubmitTxStatusResponseV2`). */
export const BridgeSubmitTxStatusResponseSchema = v.object({
  success: v.boolean(),
  data: BridgeSubmitTxStatusDataSchema,
});

/** POST /bridge/fee (`BridgeFeeResponseV2`). */
export const BridgeFeeResponseSchema = v.object({ fee: v.string() });

/** A bridge limit (`BridgeLimitV2`) — bigint `amount` serialized as a decimal string. */
const BridgeLimitSchema = v.object({
  amount: v.string(),
  decimals: v.number(),
  type: v.picklist(['DEPOSIT_LIMIT', 'WITHDRAWAL_LIMIT']),
});

/** POST /bridge/bridgeable-amount (`BridgeableAmountResponseV2`). */
export const BridgeableAmountResponseSchema = v.object({ limit: BridgeLimitSchema });

/** POST /bridge/bridgeable/check (`BridgeableCheckResponseV2`). */
export const BridgeableCheckResponseSchema = v.object({ bridgeable: v.boolean() });
