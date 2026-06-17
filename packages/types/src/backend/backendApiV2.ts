// Backend Swaps API v2 — request/response contract types.
//
// One type per request/response of every endpoint in the backend `swaps-api`
// controller (`apps/swaps-api/src/api/swaps/swaps.controller.ts`). They favor
// plain primitives (`string`/`number`/`boolean`/`bigint`/plain objects) over SDK
// branded types.
//
// Inbound (request) and outbound (response) shapes are SEPARATE types because the
// two directions genuinely differ:
// - Outbound (response) types are pure JSON: every bigint-derived value (intent
//   ids, amounts, deadlines, fees, relay chain ids) is a decimal `string`, and
//   every `Date` is an ISO 8601 `string` (e.g. `abandonedAt`). A response NEVER
//   contains `bigint` — JSON cannot represent it.
// - Inbound (request) types mirror the server's parsed request DTOs: the Intent
//   struct (`IntentRequestV2`) carries `bigint` for its numeric fields, matching
//   the backend `IntentDto`. Other request fields (amounts/deadlines on
//   `CreateIntentParamsV2`/`QuoteRequestV2`, fees, relay chain ids, etc.) are
//   decimal `string`, matching their `@IsNumberString` DTO fields.
// - `Hex` / `Address` / `Hash` / `SpokeChainKey` are plain `string` everywhere.
// - Chain-specific opaque payloads (unsigned `tx`, gas estimate, raw relay
//   `result`) are `unknown` because their shape varies by chain family.
//
// Shapes used in both directions are split into a `*RequestV2` (client → server)
// and a `*ResponseV2` (server → client) interface. `IntentRequestV2` (bigint
// numerics) and `IntentResponseV2` (all-string) genuinely differ;
// `RelayExtraDataRequestV2` / `RelayExtraDataResponseV2` are identical (no bigint
// fields). This mirrors the backend's request/response DTO pairs.

// ──────────────────────────────────────────────────────────────────────
// Shared building blocks
// ──────────────────────────────────────────────────────────────────────

/** Quote direction. Only exact-input quoting is supported. */
export type QuoteTypeV2 = 'exact_input';

/**
 * Solver intent status code:
 * -1 NOT_FOUND, 1 NOT_STARTED_YET, 2 STARTED_NOT_FINISHED, 3 SOLVED (terminal), 4 FAILED (terminal).
 */
export type SwapIntentStatusCodeV2 = -1 | 1 | 2 | 3 | 4;

/** A supported swap token descriptor (`XToken` projected to JSON primitives). */
export interface SwapTokenV2 {
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

/**
 * Intent struct (hub representation) the client SENDS in request bodies
 * (`/swaps/intents/cancel`, `/swaps/intents/hash`, `/swaps/intents/extra-data`,
 * `/swaps/submit-tx`). Mirrors the backend `IntentDto`: the numeric fields are
 * `bigint`; the transport serializes them to decimal strings on the wire.
 *
 * Differs from {@link IntentResponseV2} (the server-returned variant), whose
 * numeric fields are decimal `string` because outbound JSON cannot carry bigint.
 */
export interface IntentRequestV2 {
  /** Intent ID. */
  intentId: bigint;
  /** Creator address. */
  creator: string;
  /** Input token address (hub asset). */
  inputToken: string;
  /** Output token address (hub asset). */
  outputToken: string;
  /** Input amount in smallest unit. */
  inputAmount: bigint;
  /** Minimum acceptable output amount in smallest unit. */
  minOutputAmount: bigint;
  /** Unix timestamp (seconds) when the intent expires; `0n` for no expiry. */
  deadline: bigint;
  /** Whether partial fills are allowed. */
  allowPartialFill: boolean;
  /** Source intent-relay chain id (e.g. `146n` for Sonic). */
  srcChain: bigint;
  /** Destination intent-relay chain id. */
  dstChain: bigint;
  /** Source address (hex). */
  srcAddress: string;
  /** Destination address (hex). */
  dstAddress: string;
  /** Solver address; the zero address means "any solver". */
  solver: string;
  /** Arbitrary intent calldata (hex). */
  data: string;
}

/**
 * Intent struct (hub representation) the server RETURNS in responses
 * (`POST /swaps/intents`, `GET /swaps/intents/:txHash`). Pure JSON: all
 * bigint-derived fields are decimal strings (outbound JSON cannot carry bigint).
 *
 * Differs from {@link IntentRequestV2} (the client-sent variant), whose numeric
 * fields are `bigint`.
 */
export interface IntentResponseV2 {
  /** Intent ID (decimal string). */
  intentId: string;
  /** Creator address. */
  creator: string;
  /** Input token address (hub asset). */
  inputToken: string;
  /** Output token address (hub asset). */
  outputToken: string;
  /** Input amount in smallest unit (decimal string). */
  inputAmount: string;
  /** Minimum acceptable output amount in smallest unit (decimal string). */
  minOutputAmount: string;
  /** Unix timestamp (seconds) when the intent expires; `"0"` for no expiry (decimal string). */
  deadline: string;
  /** Whether partial fills are allowed. */
  allowPartialFill: boolean;
  /** Source intent-relay chain id (decimal string, e.g. `"146"`). */
  srcChain: string;
  /** Destination intent-relay chain id (decimal string). */
  dstChain: string;
  /** Source address (hex). */
  srcAddress: string;
  /** Destination address (hex). */
  dstAddress: string;
  /** Solver address; the zero address means "any solver". */
  solver: string;
  /** Arbitrary intent calldata (hex). */
  data: string;
}

/**
 * Relay payload the client SENDS to `POST /swaps/intents/submit` (required for
 * Solana / Bitcoin sources). Identical wire shape to {@link RelayExtraDataResponseV2}.
 */
export interface RelayExtraDataRequestV2 {
  /** Relay payload address (hex). */
  address: string;
  /** Relay payload (hex). */
  payload: string;
}

/**
 * Relay payload the server RETURNS from `POST /swaps/intents` (`relayData`) and
 * `POST /swaps/intents/extra-data`. Identical wire shape to {@link RelayExtraDataRequestV2}.
 */
export interface RelayExtraDataResponseV2 {
  /** Relay payload address (hex). */
  address: string;
  /** Relay payload (hex). */
  payload: string;
}

// ──────────────────────────────────────────────────────────────────────
// GET /swaps/tokens · GET /swaps/tokens/:chainKey
// ──────────────────────────────────────────────────────────────────────

/** GET /swaps/tokens — map of SpokeChainKey → supported swap tokens. */
export type GetSwapTokensResponseV2 = Record<string, readonly SwapTokenV2[]>;

/** GET /swaps/tokens/:chainKey — supported swap tokens for a single chain. */
export type GetSwapTokensByChainResponseV2 = readonly SwapTokenV2[];

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/quote
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/quote — request body. */
export interface QuoteRequestV2 {
  /** Source token address on the source spoke chain. */
  tokenSrc: string;
  /** Source spoke chain key (SODAX SpokeChainKey). */
  tokenSrcChainKey: string;
  /** Destination token address on the destination spoke chain. */
  tokenDst: string;
  /** Destination spoke chain key (SODAX SpokeChainKey). */
  tokenDstChainKey: string;
  /** Input amount in smallest unit of the source token (decimal string). */
  amount: string;
  /** Quote type (only `exact_input` is supported). */
  quoteType: QuoteTypeV2;
  /** Source address — required only when `includeTxData=true`; ignored otherwise. */
  srcAddress?: string;
  /** Destination address — required only when `includeTxData=true`; ignored otherwise. */
  dstAddress?: string;
}

/** POST /swaps/quote — query params. */
export interface QuoteQueryV2 {
  /** When true, also build and return `{ tx, intent, relayData }` using the quoted amount as `minOutputAmount`. */
  includeTxData?: boolean;
}

/** POST /swaps/quote — response body. */
export interface QuoteResponseV2 {
  /** Quoted output amount in smallest unit of the destination token (decimal string). */
  quotedAmount: string;
  /** Unsigned create-intent transaction; present only when `includeTxData=true`. */
  txData?: CreateIntentResponseV2;
}

// ──────────────────────────────────────────────────────────────────────
// GET /swaps/deadline
// ──────────────────────────────────────────────────────────────────────

/** GET /swaps/deadline — query params. */
export interface DeadlineQueryV2 {
  /** Offset in seconds added to the hub timestamp. Defaults to 300 (5 minutes); minimum 1. */
  offsetSeconds?: number;
}

/** GET /swaps/deadline — response body. */
export interface DeadlineResponseV2 {
  /** Unix timestamp (seconds) at which the swap intent will expire (decimal string). */
  deadline: string;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/allowance/check · POST /swaps/approve · POST /swaps/intents
// (all three share the CreateIntentParamsV2 request body)
// ──────────────────────────────────────────────────────────────────────

/** Shared request body for `/swaps/allowance/check`, `/swaps/approve`, and `/swaps/intents`. */
export interface CreateIntentParamsV2 {
  /** Source spoke chain key (SODAX SpokeChainKey). */
  srcChainKey: string;
  /** Destination spoke chain key (SODAX SpokeChainKey). */
  dstChainKey: string;
  /** Input token address on the source spoke chain. */
  inputToken: string;
  /** Output token address on the destination spoke chain. */
  outputToken: string;
  /** Input amount in smallest unit of the input token (decimal string). */
  inputAmount: string;
  /** Minimum acceptable output in smallest unit of the output token (decimal string). */
  minOutputAmount: string;
  /** Unix timestamp (seconds) at which the intent expires; `"0"` for limit-order semantics (decimal string). */
  deadline: string;
  /** Whether partial fills are allowed for this intent. */
  allowPartialFill: boolean;
  /** User address on the source spoke chain (chain-specific format). */
  srcAddress: string;
  /** Source-chain signer public key (compressed hex), for chains whose address can't yield it (e.g. Stacks). */
  srcPublicKey?: string;
  /** Recipient address on the destination spoke chain (chain-specific format). */
  dstAddress: string;
  /** Solver address (EVM hub address). Defaults to the zero address for "any solver". */
  solver?: string;
  /** Arbitrary calldata hex string. Defaults to `0x`. */
  data?: string;
}

/** POST /swaps/allowance/check — response body. */
export interface AllowanceCheckResponseV2 {
  /** True when the source token allowance is already sufficient for the intent. */
  valid: boolean;
}

/** POST /swaps/approve — response body. */
export interface ApproveResponseV2 {
  /** Unsigned approval transaction (chain-specific shape). For EVM: `{ from, to, value, data }`. */
  tx: unknown;
}

/** POST /swaps/intents — response body. */
export interface CreateIntentResponseV2 {
  /** Unsigned create-intent transaction (chain-specific shape). For EVM: `{ from, to, value, data }`. */
  tx: unknown;
  /** Built intent struct (hub representation). */
  intent: IntentResponseV2;
  /** Extra data required when calling `POST /swaps/intents/submit`. */
  relayData: RelayExtraDataResponseV2;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/intents/submit
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/intents/submit — request body. */
export interface SubmitIntentRequestV2 {
  /** Intent-relay chain id of the source chain (decimal string). NOT the SpokeChainKey. */
  chainId: string;
  /** Transaction hash on the source spoke chain after the caller broadcast the intent tx. */
  txHash: string;
  /** Required for Solana / Bitcoin sources — pass the `relayData` returned by `/swaps/intents` verbatim. */
  data?: RelayExtraDataRequestV2;
}

/** POST /swaps/intents/submit — response body. */
export interface SubmitIntentResponseV2 {
  /** Raw response from the intent relay. Shape varies; treat as opaque. */
  result: unknown;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/intents/status
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/intents/status — request body. */
export interface StatusRequestV2 {
  /** Hub-side intent transaction hash (32-byte hex). */
  intentTxHash: string;
}

/** POST /swaps/intents/status — response body. */
export interface StatusResponseV2 {
  /** Solver intent status code. */
  status: SwapIntentStatusCodeV2;
  /** Fill transaction hash on the destination chain. Present only when `status === 3` (SOLVED). */
  fillTxHash?: string;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/intents/cancel
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/intents/cancel — request body. */
export interface CancelIntentRequestV2 {
  /** Source spoke chain key on which the intent was created. */
  srcChainKey: string;
  /** Intent struct (as returned by `/swaps/intents`). */
  intent: IntentRequestV2;
}

/** POST /swaps/intents/cancel — response body. */
export interface CancelIntentResponseV2 {
  /** Unsigned cancel transaction (chain-specific shape). For EVM: `{ from, to, value, data }`. */
  tx: unknown;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/intents/hash
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/intents/hash — request body. */
export interface IntentHashRequestV2 {
  /** Intent struct to hash. */
  intent: IntentRequestV2;
}

/** POST /swaps/intents/hash — response body. */
export interface IntentHashResponseV2 {
  /** keccak256 hash of the intent struct (32-byte hex). */
  hash: string;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/intents/packet
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/intents/packet — request body. */
export interface IntentPacketRequestV2 {
  /** Destination spoke chain key on which the intent was filled. */
  chainId: string;
  /** Fill transaction hash on the destination chain (returned by `/swaps/intents/status`). */
  fillTxHash: string;
  /** Polling timeout in milliseconds. Defaults to the SDK default (~60s); minimum 1. */
  timeout?: number;
}

/** POST /swaps/intents/packet — response body. */
export interface IntentPacketResponseV2 {
  /** Source intent-relay chain id (numeric). */
  srcChainId: number;
  /** Source-chain transaction hash that originated the packet. */
  srcTxHash: string;
  /** Encoded source address. */
  srcAddress: string;
  /** Relay status (e.g. `executed`). */
  status: string;
  /** Destination intent-relay chain id (numeric). */
  dstChainId: number;
  /** Connection sequence number assigned by the relay. */
  connSn: number;
  /** Encoded destination address. */
  dstAddress: string;
  /** Destination-chain transaction hash where the fill landed. */
  dstTxHash: string;
  /** Relay signatures collected for this packet. */
  signatures: string[];
  /** Packet payload (hex). */
  payload: string;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/intents/extra-data
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/intents/extra-data — request body. Provide EITHER `txHash` OR `intent`, not both. */
export interface IntentExtraDataRequestV2 {
  /** Source-chain tx hash. Provide either this OR `intent`. */
  txHash?: string;
  /** Intent struct. Provide either this OR `txHash`. */
  intent?: IntentRequestV2;
}

/** POST /swaps/intents/extra-data — response body (same shape as relay extra data). */
export type IntentExtraDataResponseV2 = RelayExtraDataResponseV2;

// ──────────────────────────────────────────────────────────────────────
// GET /swaps/intents/:txHash/fill · GET /swaps/intents/:txHash
// ──────────────────────────────────────────────────────────────────────

/** GET /swaps/intents/:txHash/fill — on-chain fill state for an intent. */
export interface IntentStateV2 {
  /** Whether the intent exists on the hub chain. */
  exists: boolean;
  /** Remaining input amount left to fill (decimal string). */
  remainingInput: string;
  /** Received output amount so far (decimal string). */
  receivedOutput: string;
  /** Whether a payment is pending. */
  pendingPayment: boolean;
}

/**
 * GET /swaps/intents/:txHash — decoded Intent struct from the hub's IntentCreated
 * event. Bigint fields are serialized as decimal strings.
 */
export type GetIntentResponseV2 = IntentResponseV2;

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/limit-orders
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/limit-orders — request body. Same as create-intent but `deadline` is optional. */
export type CreateLimitOrderParamsV2 = Omit<CreateIntentParamsV2, 'deadline'> & {
  /** Unix timestamp (seconds) at which the limit order expires. Omit (or pass `"0"`) for no expiry. */
  deadline?: string;
};

/** POST /swaps/limit-orders — response body (same shape as create-intent). */
export type CreateLimitOrderResponseV2 = CreateIntentResponseV2;

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/gas/estimate
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/gas/estimate — request body. */
export interface GasEstimateRequestV2 {
  /** Spoke chain key the transaction targets. */
  chainKey: string;
  /** Raw transaction object (chain-specific shape). For EVM: `{ from, to, value, data }` with `value` as decimal string. */
  tx: Record<string, unknown>;
}

/** POST /swaps/gas/estimate — response body. */
export interface GasEstimateResponseV2 {
  /**
   * Gas estimate. Shape varies by chain family: EVM/Bitcoin/Near/Solana →
   * decimal string (bigint); Sui/Stellar/Stacks/Icon/Injective → structured object.
   */
  gas: unknown;
}

// ──────────────────────────────────────────────────────────────────────
// GET /swaps/fees/partner · GET /swaps/fees/solver
// ──────────────────────────────────────────────────────────────────────

/** GET /swaps/fees/partner and GET /swaps/fees/solver — query params. */
export interface FeeQueryV2 {
  /** Input amount in smallest unit (decimal string). */
  amount: string;
}

/** GET /swaps/fees/partner and GET /swaps/fees/solver — response body. */
export interface FeeResponseV2 {
  /** Fee amount in smallest unit of the input token (decimal string). */
  fee: string;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/submit-tx · GET /swaps/submit-tx/status
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/submit-tx — request body. */
export interface SubmitTxRequestV2 {
  /** Transaction hash of the tx that will be submitted (1–127 chars). */
  txHash: string;
  /** Source chain key (spoke chain the tx will be submitted from). */
  srcChainKey: string;
  /** Address of the wallet that will submit the tx (1–127 chars). */
  walletAddress: string;
  /** Intent object received from createIntent. */
  intent: IntentRequestV2;
  /** Relay data received from createIntent, submitted to the intent relay (hex). */
  relayData: string;
}

/** POST /swaps/submit-tx — response `data` payload. */
export interface SubmitTxResponseDataV2 {
  /** Whether the row was newly inserted or matched an existing record. */
  status: 'inserted' | 'duplicate';
  /** Message indicating the result of the submission. */
  message: string;
}

/** POST /swaps/submit-tx — response body. */
export interface SubmitTxResponseV2 {
  /** True when the submission was accepted (or was a duplicate). */
  success: boolean;
  /** Submission result payload. */
  data: SubmitTxResponseDataV2;
}

/** GET /swaps/submit-tx/status — query params. */
export interface SubmitTxStatusQueryV2 {
  /** Transaction hash of the submitted swap tx (1–127 chars). */
  txHash: string;
  /** Source chain key. */
  srcChainKey: string;
}

/** Lifecycle status of a submitted swap tx. */
export type SubmitSwapTxStatusV2 = 'pending' | 'relaying' | 'relayed' | 'posting_execution' | 'executed' | 'failed';

/** Lifecycle status of a cross-chain relay packet. */
export type PacketDataStatusV2 = 'pending' | 'validating' | 'executing' | 'executed';

/** Relay packet data attached to a submit-tx processing result (snake_case as stored). */
export interface PacketDataV2 {
  /** Source intent-relay chain id (numeric). */
  src_chain_id: number;
  /** Source-chain transaction hash. */
  src_tx_hash: string;
  /** Encoded source address. */
  src_address: string;
  /** Packet lifecycle status. */
  status: PacketDataStatusV2;
  /** Destination intent-relay chain id (numeric). */
  dst_chain_id: number;
  /** Connection sequence number assigned by the relay. */
  conn_sn: number;
  /** Encoded destination address. */
  dst_address: string;
  /** Destination-chain transaction hash. */
  dst_tx_hash: string;
  /** Relay signatures collected for this packet. */
  signatures: string[];
  /** Packet payload (hex). */
  payload: string;
}

/** Processing result for a submitted swap tx (present when executed). */
export interface SubmitTxStatusResultV2 {
  /** Destination intent tx hash. */
  dstIntentTxHash: string;
  /** Packet data from the relay. */
  packetData?: PacketDataV2;
  /** Intent hash from the solver API (populated after post-execution). */
  intent_hash?: string;
}

/** Processing state of a submitted swap tx. */
export interface SubmitTxStatusDataV2 {
  /** Transaction hash. */
  txHash: string;
  /** Source chain key. */
  srcChainKey: string;
  /** Current processing status. */
  status: SubmitSwapTxStatusV2;
  /** Step where processing failed. */
  failedAtStep?: SubmitSwapTxStatusV2;
  /** Failure reason. */
  failureReason?: string;
  /** Number of processing attempts (claim-time counter). */
  processingAttempts: number;
  /** ISO 8601 timestamp set when the swap exhausted its processing budget and was abandoned. */
  abandonedAt?: string;
  /** Processing result (present when executed). */
  result?: SubmitTxStatusResultV2;
  /** User-facing hint when status is failed or the swap was abandoned. */
  userMessage?: string;
  /** True when an on-chain INTENT_CANCELLED event exists for this swap's intent (failed swaps only). */
  intentCancelled?: boolean;
}

/** GET /swaps/submit-tx/status — response body. */
export interface SubmitTxStatusResponseV2 {
  /** True when a record was found. */
  success: boolean;
  /** The submit-tx processing state. */
  data: SubmitTxStatusDataV2;
}

// ──────────────────────────────────────────────────────────────────────
// Aggregating client interface — one method per endpoint
// ──────────────────────────────────────────────────────────────────────

/**
 * Client-side surface for the backend Swaps API v2 — for typed HTTP clients
 * (fetch wrappers / SDK adapters). Each method describes one endpoint as the
 * client sees it: all methods are async and all field types are the
 * post-serialization wire shapes above (bigint/Date → decimal/ISO `string`).
 *
 * Do NOT `implements` this on the NestJS `SwapsController`. Handlers return
 * pre-serialization domain types (`bigint`, `Date`, branded `Hex`/`Address`/
 * `SpokeChainKey`) and may be synchronous; the response interceptor serializes
 * them into these wire shapes afterwards. A single class cannot be both the
 * pre-serialization producer and the post-serialization contract.
 */
export interface ISwapsApiV2 {
  /** GET /swaps/tokens */
  getTokens(): Promise<GetSwapTokensResponseV2>;
  /** GET /swaps/tokens/:chainKey */
  getTokensByChain(chainKey: string): Promise<GetSwapTokensByChainResponseV2>;
  /** POST /swaps/quote */
  getQuote(body: QuoteRequestV2, query?: QuoteQueryV2): Promise<QuoteResponseV2>;
  /** GET /swaps/deadline */
  getDeadline(query?: DeadlineQueryV2): Promise<DeadlineResponseV2>;
  /** POST /swaps/allowance/check */
  checkAllowance(body: CreateIntentParamsV2): Promise<AllowanceCheckResponseV2>;
  /** POST /swaps/approve */
  approve(body: CreateIntentParamsV2): Promise<ApproveResponseV2>;
  /** POST /swaps/intents */
  createIntent(body: CreateIntentParamsV2): Promise<CreateIntentResponseV2>;
  /** POST /swaps/intents/submit */
  submitIntent(body: SubmitIntentRequestV2): Promise<SubmitIntentResponseV2>;
  /** POST /swaps/intents/status */
  getStatus(body: StatusRequestV2): Promise<StatusResponseV2>;
  /** POST /swaps/intents/cancel */
  cancelIntent(body: CancelIntentRequestV2): Promise<CancelIntentResponseV2>;
  /** POST /swaps/intents/hash */
  getIntentHash(body: IntentHashRequestV2): Promise<IntentHashResponseV2>;
  /** POST /swaps/intents/packet */
  getSolvedIntentPacket(body: IntentPacketRequestV2): Promise<IntentPacketResponseV2>;
  /** POST /swaps/intents/extra-data */
  getIntentSubmitTxExtraData(body: IntentExtraDataRequestV2): Promise<IntentExtraDataResponseV2>;
  /** GET /swaps/intents/:txHash/fill */
  getFilledIntent(txHash: string): Promise<IntentStateV2>;
  /** GET /swaps/intents/:txHash */
  getIntent(txHash: string): Promise<GetIntentResponseV2>;
  /** POST /swaps/limit-orders */
  createLimitOrderIntent(body: CreateLimitOrderParamsV2): Promise<CreateLimitOrderResponseV2>;
  /** POST /swaps/gas/estimate */
  estimateGas(body: GasEstimateRequestV2): Promise<GasEstimateResponseV2>;
  /** GET /swaps/fees/partner */
  getPartnerFee(query: FeeQueryV2): Promise<FeeResponseV2>;
  /** GET /swaps/fees/solver */
  getSolverFee(query: FeeQueryV2): Promise<FeeResponseV2>;
  /** POST /swaps/submit-tx */
  submitTx(body: SubmitTxRequestV2): Promise<SubmitTxResponseV2>;
  /** GET /swaps/submit-tx/status */
  getSubmitTxStatus(query: SubmitTxStatusQueryV2): Promise<SubmitTxStatusResponseV2>;
}
