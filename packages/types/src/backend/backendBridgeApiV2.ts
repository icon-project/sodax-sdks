// Backend Bridge API v2 — request/response contract types.
//
// Mirrors `backendApiV2.ts` (Swaps API v2). One type per request/response of every
// endpoint in the backend bridge controller. Same JSON-safety rule: outbound
// (response) values are pure JSON — every bigint-derived value is a decimal
// `string`, every `Date` an ISO 8601 `string`; the one typed exception is the
// unsigned `tx` (the SDK domain union `RawTxReturnType`).
//
// TODO(gh-255): implement. Reference to mirror:
//   packages/types/src/backend/backendApiV2.ts  (ISwapsApiV2 + *RequestV2/*ResponseV2)
// Reuse `RawTxReturnType` (from ../common/index.js) and `RelayExtraDataResponseV2`
// + `PacketDataV2` (from ./backendApiV2.js). Bridge deltas vs swaps:
//   - NO `intent` struct (createBridgeIntent returns { tx, relayData }).
//   - NO solver / `intent_hash` / `posting_execution` (terminal = executed + dstIntentTxHash).
//   - smaller surface (~5 methods): checkAllowance, approve, createBridgeIntent, submitTx, getSubmitTxStatus.
//   - GetBridgeTokensByChainResponseV2 must be `type = readonly BridgeTokenV2[]`, NOT an interface.
//   - confirm exact routes/DTO fields against the backend bridge controller (Open Q #1).
//
// Planned surface (draft — confirm against backend before relying on it):
//   import type { RawTxReturnType } from '../common/index.js';
//   import type { RelayExtraDataResponseV2, PacketDataV2 } from './backendApiV2.js';
//   export interface CreateBridgeIntentParamsV2 { srcAddress; srcChainKey; srcToken; amount: string; dstChainKey; dstToken; recipient: string }
//   export interface BridgeAllowanceCheckResponseV2 { valid: boolean }
//   export interface BridgeApproveResponseV2 { tx: RawTxReturnType }
//   export interface CreateBridgeIntentResponseV2 { tx: RawTxReturnType; relayData: RelayExtraDataResponseV2 }
//   export interface BridgeSubmitTxRequestV2 { txHash; srcChainKey; walletAddress; relayData: string }
//   export interface BridgeSubmitTxResponseV2 { success: boolean; data: { status: 'inserted'|'duplicate'; message: string } }
//   export interface BridgeSubmitTxStatusQueryV2 { txHash: string; srcChainKey: string }
//   export type SubmitBridgeTxStatusV2 = 'pending'|'relaying'|'relayed'|'executed'|'failed'
//   export interface BridgeSubmitTxStatusResultV2 { dstIntentTxHash: string; packetData?: PacketDataV2 }
//   export interface BridgeSubmitTxStatusDataV2 { txHash; srcChainKey; status: SubmitBridgeTxStatusV2; failedAtStep?; failureReason?; processingAttempts: number; abandonedAt?: string; result?: BridgeSubmitTxStatusResultV2; userMessage? }
//   export interface BridgeSubmitTxStatusResponseV2 { success: boolean; data: BridgeSubmitTxStatusDataV2 }
//   export interface IBridgeApiV2 { checkAllowance; approve; createBridgeIntent; submitTx; getSubmitTxStatus }
//
// Also TODO: export this module from ./index.ts, and add the JSON-safety guard
// (`_AssertJsonSafe`) used in backendApiV2.ts to at least one alias.

export {};
