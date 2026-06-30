// valibot response schemas for the Bridge API — one per IBridgeApiV2 response.
//
// TODO(gh-255): implement. Reference to mirror:
//   packages/sdk/src/backendApi/swapsApiSchemas.ts
// Rules (same as swaps): bigint-derived wire fields = v.string(); ints = v.number();
// status = v.picklist([...]). Tx-bearing responses are FACTORIES reusing the shared
// per-chain raw-tx schema selector:
//   import { rawTxSchemaForChainKey } from './rawTxSchemas.js';
//   export const makeBridgeApproveResponseSchema = (txSchema) => v.object({ tx: txSchema });
//   export const makeCreateBridgeIntentResponseSchema = (txSchema) => v.object({ tx: txSchema, relayData: RelayExtraDataResponseSchema });
//   export const BridgeAllowanceCheckResponseSchema = v.object({ valid: v.boolean() });
//   export const BridgeSubmitTxResponseSchema = v.object({ success: v.boolean(), data: v.object({ status: v.picklist(['inserted','duplicate']), message: v.string() }) });
//   export const BridgeSubmitTxStatusResponseSchema = v.object({ success: v.boolean(), data: <module-private status-data schema> });
// NOTE: if `RelayExtraDataResponseSchema` is not exported from swapsApiSchemas.ts,
// declare a local `v.object({ address: v.string(), payload: v.string() })`.
// Keep status-data/result/packet sub-schemas module-private; do NOT re-export this
// module from backendApi/index.ts (package-internal, like swapsApiSchemas).

export {};
