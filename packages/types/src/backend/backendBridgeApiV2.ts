// Backend Bridge API v2 — request/response contract types.
//
// Mirrors `backendApiV2.ts` (Swaps API v2). One type per request/response of every
// endpoint in the backend bridge controller (`@Controller('bridge')`, served on the
// shared swaps host). They favor plain primitives (`string`/`number`/`boolean`/plain
// objects) over SDK branded types.
//
// Same JSON-safety rule as the swaps section: outbound (response) values are pure
// JSON — every bigint-derived value is a decimal `string`, every `Date` an ISO 8601
// `string`. A response NEVER contains `bigint` on the wire (the one typed exception
// is the unsigned `tx`, the SDK domain union `RawTxReturnType`, which the SDK
// client's response schema rebuilds into `bigint`/`Uint8Array` on parse).
//
// Bridge deltas vs swaps:
//   - NO `intent` struct — `createBridgeIntent` returns `{ tx, relayData }`.
//   - NO solver / `intent_hash` / `posting_execution` — terminal success is
//     `status === 'executed' && result.dstIntentTxHash`.
//   - `submit-tx` carries the FULL `relayData { address, payload }` envelope: with no
//     `intent.creator` the backend cannot rebuild the relay address, so the client sends it.
//   - Smaller surface (7 methods): checkAllowance, approve, createBridgeIntent,
//     submitTx, getSubmitTxStatus, getTokens, getTokensByChain.

import type { RawTxReturnType } from '../common/index.js';
import type { BitcoinBoundExtrasV2, PacketDataV2, RelayExtraDataResponseV2 } from './backendApiV2.js';

// ──────────────────────────────────────────────────────────────────────
// GET /bridge/tokens · GET /bridge/tokens/:chainKey
// ──────────────────────────────────────────────────────────────────────

/** A supported bridge token descriptor (`XToken` projected to JSON primitives). */
export interface BridgeTokenV2 {
  /** Token symbol (e.g. `USDC`). */
  symbol: string;
  /** Token name (e.g. `USD Coin`). */
  name: string;
  /** Token decimals. */
  decimals: number;
  /** Token address on its spoke chain (or hub address for hub tokens). */
  address: string;
  /** SODAX SpokeChainKey identifier (e.g. `0xa4b1.arbitrum`, `solana`). */
  chainKey: string;
  /** Corresponding hub-side asset address on Sonic. */
  hubAsset: string;
  /** Hub vault address that custodies bridged liquidity for this token. */
  vault: string;
}

/** GET /bridge/tokens — map of SpokeChainKey → supported bridge tokens. */
export type GetBridgeTokensResponseV2 = Record<string, readonly BridgeTokenV2[]>;

/**
 * GET /bridge/tokens/:chainKey — supported bridge tokens for a single chain.
 *
 * The trailing `& _AssertJsonSafe<…>` wires the compile-time JSON-safety guard into
 * the bridge wire surface: if a `bigint` ever leaks into `BridgeTokenV2`, the
 * constraint fails and `pnpm checkTs` / `pnpm build` go red. It is `& unknown` in the
 * happy path, so it does not change the type.
 */
export type GetBridgeTokensByChainResponseV2 = readonly BridgeTokenV2[] &
  _AssertJsonSafe<[_ContainsBigint<BridgeTokenV2>] extends [false] ? true : false>;

// ──────────────────────────────────────────────────────────────────────
// POST /bridge/allowance/check · POST /bridge/approve · POST /bridge/intents
// (all three share the CreateBridgeIntentParamsV2 request body)
// ──────────────────────────────────────────────────────────────────────

/**
 * Shared request body for `/bridge/allowance/check`, `/bridge/approve`, and
 * `/bridge/intents`. Uses the swaps param naming: the SDK maps its domain
 * `CreateBridgeIntentParams` (`srcToken`/`dstToken`/`amount`/`recipient`) onto these
 * wire names before the POST.
 *
 * Unlike swaps there is NO partner-fee field (bridge fee is config-driven). The Bitcoin
 * Bound token is carried as `bound.accessToken`, mirroring the SDK's grouped `extras.bound`.
 */
export interface CreateBridgeIntentParamsV2 {
  /** Source spoke chain key (SODAX SpokeChainKey). */
  srcChainKey: string;
  /** Destination spoke chain key (SODAX SpokeChainKey). */
  dstChainKey: string;
  /** Input token address on the source spoke chain (SDK domain `srcToken`). */
  inputToken: string;
  /** Output token address on the destination spoke chain (SDK domain `dstToken`). */
  outputToken: string;
  /** Input amount in smallest unit of the input token (SDK domain `amount`; bigint → decimal string). */
  inputAmount: string;
  /** User address on the source spoke chain (chain-specific format). */
  srcAddress: string;
  /** Recipient address on the destination spoke chain (SDK domain `recipient`). */
  dstAddress: string;
  /**
   * Source-chain signer public key (compressed hex), for chains whose address can't
   * yield it (e.g. Stacks). Only used when building a raw intent.
   */
  srcPublicKey?: string;
  /**
   * Bitcoin Bound (Radfi) inputs, grouped so future Bound fields extend one slot.
   * Only used for raw Bitcoin TRADING-mode intents.
   */
  bound?: BitcoinBoundExtrasV2;
}

/** POST /bridge/allowance/check — response body. */
export interface BridgeAllowanceCheckResponseV2 {
  /** True when the source token allowance is already sufficient for the bridge. */
  valid: boolean;
}

/** POST /bridge/approve — response body. */
export interface BridgeApproveResponseV2 {
  /** Unsigned approval transaction — the `RawTxReturnType` variant for the request's `srcChainKey`. */
  tx: RawTxReturnType;
}

/**
 * POST /bridge/intents — response body. No `intent` struct (bridge is vault-backed,
 * not solver-based); `createBridgeIntent` returns the unsigned spoke-deposit tx plus
 * the relay envelope.
 */
export interface CreateBridgeIntentResponseV2 {
  /** Unsigned spoke-deposit transaction — the `RawTxReturnType` variant for the request's `srcChainKey`. */
  tx: RawTxReturnType;
  /** Relay envelope `{ address, payload }` submitted to the intent relay. */
  relayData: RelayExtraDataResponseV2;
}

// ──────────────────────────────────────────────────────────────────────
// POST /bridge/submit-tx · GET /bridge/submit-tx/status
// ──────────────────────────────────────────────────────────────────────

/**
 * POST /bridge/submit-tx — request body. Idempotent on `(txHash, srcChainKey)`.
 *
 * Carries the FULL `relayData { address, payload }` envelope: bridge has no
 * `intent.creator` for the backend to rebuild the relay address, so the client sends it —
 * dropping the address would break split-tx-chain relay (Stellar/Solana/Sui/Stacks…).
 */
export interface BridgeSubmitTxRequestV2 {
  /** Transaction hash of the spoke-deposit tx that was broadcast (1–127 chars). */
  txHash: string;
  /** Source chain key (spoke chain the tx was submitted from). */
  srcChainKey: string;
  /** Address of the wallet that submitted the tx (1–127 chars). */
  walletAddress: string;
  /** Relay envelope received from createBridgeIntent, submitted to the intent relay. */
  relayData: RelayExtraDataResponseV2;
}

/** POST /bridge/submit-tx — response `data` payload. */
export interface BridgeSubmitTxResponseDataV2 {
  /** Whether the row was newly inserted or matched an existing record. */
  status: 'inserted' | 'duplicate';
  /** Message indicating the result of the submission. */
  message: string;
}

/** POST /bridge/submit-tx — response body. */
export interface BridgeSubmitTxResponseV2 {
  /** True when the submission was accepted (or was a duplicate). */
  success: boolean;
  /** Submission result payload. */
  data: BridgeSubmitTxResponseDataV2;
}

/** GET /bridge/submit-tx/status — query params. */
export interface BridgeSubmitTxStatusQueryV2 {
  /** Transaction hash of the submitted bridge tx (1–127 chars). */
  txHash: string;
  /** Source chain key. */
  srcChainKey: string;
}

/**
 * Lifecycle status of a submitted bridge tx. 5-state: drops the swaps-only
 * `'posting_execution'` (bridge has no solver post-execution). The SDK schema stays
 * tolerant of unknown states so a future backend extension never breaks parse.
 */
export type SubmitBridgeTxStatusV2 = 'pending' | 'relaying' | 'relayed' | 'executed' | 'failed';

/** Processing result for a submitted bridge tx (present when executed). No `intent_hash` (no solver). */
export interface BridgeSubmitTxStatusResultV2 {
  /** Destination intent tx hash. */
  dstIntentTxHash: string;
  /** Packet data from the relay. */
  packetData?: PacketDataV2;
}

/** Processing state of a submitted bridge tx. */
export interface BridgeSubmitTxStatusDataV2 {
  /** Transaction hash. */
  txHash: string;
  /** Source chain key. */
  srcChainKey: string;
  /**
   * Current processing status. Typed as `string` (not the {@link SubmitBridgeTxStatusV2} union)
   * because the SDK response schema is deliberately tolerant of unknown states, so a future
   * backend lifecycle addition never breaks response parsing. Compare against the
   * {@link SubmitBridgeTxStatusV2} literals for the known terminal states (`'executed'`/`'failed'`).
   */
  status: string;
  /** Step where processing failed (one of {@link SubmitBridgeTxStatusV2}; tolerant `string`). */
  failedAtStep?: string;
  /** Failure reason. */
  failureReason?: string;
  /** Number of processing attempts (claim-time counter). */
  processingAttempts: number;
  /** ISO 8601 timestamp set when the bridge exhausted its processing budget and was abandoned. */
  abandonedAt?: string;
  /** Processing result (present when executed). */
  result?: BridgeSubmitTxStatusResultV2;
  /** User-facing hint when status is failed or the bridge was abandoned. */
  userMessage?: string;
}

/** GET /bridge/submit-tx/status — response body. */
export interface BridgeSubmitTxStatusResponseV2 {
  /** True when a record was found. */
  success: boolean;
  /** The submit-tx processing state. */
  data: BridgeSubmitTxStatusDataV2;
}

// ──────────────────────────────────────────────────────────────────────
// Aggregating client interface — one method per endpoint
// ──────────────────────────────────────────────────────────────────────

/**
 * Client-side surface for the backend Bridge API v2 — for typed HTTP clients
 * (fetch wrappers / SDK adapters). Each method describes one endpoint as the client
 * sees it: all methods are async and all field types are the post-serialization wire
 * shapes above (bigint/Date → decimal/ISO `string`).
 *
 * As with {@link import('./backendApiV2.js').ISwapsApiV2}, do NOT `implements` this
 * on the NestJS controller: handlers return pre-serialization domain types and the
 * response interceptor serializes them into these wire shapes afterwards.
 *
 * Bridgeable-amount stays CLIENT-SIDE (vault math; no backend endpoint).
 */
export interface IBridgeApiV2 {
  /** POST /bridge/allowance/check */
  checkAllowance(body: CreateBridgeIntentParamsV2): Promise<BridgeAllowanceCheckResponseV2>;
  /** POST /bridge/approve */
  approve(body: CreateBridgeIntentParamsV2): Promise<BridgeApproveResponseV2>;
  /** POST /bridge/intents */
  createBridgeIntent(body: CreateBridgeIntentParamsV2): Promise<CreateBridgeIntentResponseV2>;
  /** POST /bridge/submit-tx */
  submitTx(body: BridgeSubmitTxRequestV2): Promise<BridgeSubmitTxResponseV2>;
  /** GET /bridge/submit-tx/status */
  getSubmitTxStatus(query: BridgeSubmitTxStatusQueryV2): Promise<BridgeSubmitTxStatusResponseV2>;
  /** GET /bridge/tokens */
  getTokens(): Promise<GetBridgeTokensResponseV2>;
  /** GET /bridge/tokens/:chainKey */
  getTokensByChain(chainKey: string): Promise<GetBridgeTokensByChainResponseV2>;
}

// ──────────────────────────────────────────────────────────────────────
// Compile-time drift guard
// ──────────────────────────────────────────────────────────────────────
//
// Private re-declaration of the swaps-section JSON-safety helpers (non-exported in
// `backendApiV2.ts`). Kept module-private here too so knip sees them as used (by
// `GetBridgeTokensByChainResponseV2`) and not as an unused export.

/** True if `T` contains a `bigint` anywhere in its data shape. Recurses arrays/records/objects. */
type _ContainsBigint<T> = T extends bigint
  ? true
  : T extends string | number | boolean | symbol | null | undefined
    ? false
    : T extends readonly (infer U)[]
      ? _ContainsBigint<U>
      : T extends object
        ? true extends { [K in keyof T]-?: _ContainsBigint<T[K]> }[keyof T]
          ? true
          : false
        : false;

/**
 * Resolves to `unknown` (an identity in an intersection) when `Ok` proves JSON-safety;
 * otherwise the `Ok extends true` constraint is violated and compilation fails at the use site.
 */
type _AssertJsonSafe<_Ok extends true> = unknown;
