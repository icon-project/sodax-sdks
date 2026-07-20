// JSON-safe wire contract for GASLESS SWAPS. Composes the feature-agnostic gasless contract
// (gaslessApi.ts) with the V2 swap DTOs (backendApiV2.ts). Fulfilled in-process by the brain
// (sodax.gaslessSwap, composing SwapService + GaslessService) and over HTTP by sodax.api.gaslessSwap.
// Every field is string/number/boolean — no bigint, no viem branded types.
//
// PREREQUISITE (not on this interface): `CreateIntentParamsV2.minOutputAmount` and `.deadline` come from
// sodax.api.swaps.getQuote / getDeadline (ISwapsApiV2) — same as the normal swap flow.
//
// Two modes, both = 2 backend calls + a shared status poll, converging on completeSwap:
//   Mode B (private key):    prepareSwap → (client signs userOpHash [+ EIP-7702 auth]) → submitSwap → completeSwap → poll
//   Mode A (browser wallet): buildSwapCalls → (client wallet_sendCalls) → completeSwap → poll
// Mode A: buildSwapCalls returns the ENCODED EIP-5792 [approve, transfer] batch + capabilities, so a
// pure-HTTP (non-SDK) client passes them straight to its wallet's `wallet_sendCalls` — the wallet RPC is
// inherently client-side (a backend cannot invoke a browser wallet), but NO SDK import is needed. Sponsored
// Mode A over HTTP requires the backend to expose a client-safe paymaster (a `paymasterProxyUrl` proxy); the
// Pimlico API key is never returned. An SDK consumer may instead pass the intent to sodax.gasless.sendCalls.

import type {
  GaslessApiErrorCode,
  GaslessCapabilitiesRequest,
  GaslessCapabilitiesResponse,
  GaslessPrepareResponse,
  GaslessSubmitRequest,
  GaslessSubmitResponse,
} from './gaslessApi.js';
import type {
  CreateIntentParamsV2,
  IntentResponseV2,
  RelayExtraDataResponseV2,
  SubmitTxRequestV2,
  SubmitTxResponseV2,
  SubmitTxStatusQueryV2,
  SubmitTxStatusResponseV2,
} from './backendApiV2.js';

/** Result of {@link IGaslessSwapApi.prepareSwap} (Mode B). `prepared` is signed then echoed VERBATIM into
 *  `submitSwap`; `intent` + `relayData` are carried into `completeSwap`. All members are JSON-safe. */
export interface GaslessSwapPrepareResponse {
  /** Unsigned UserOp + userOpHash (+ EIP-7702 authorization tuple when delegation is still needed). */
  prepared: GaslessPrepareResponse;
  /** The built swap intent (all-string), needed by `completeSwap`. */
  intent: IntentResponseV2;
  /** `{ address, payload }` — hub recipient + action payload, needed by `completeSwap`. */
  relayData: RelayExtraDataResponseV2;
}

/** A single EIP-5792 call in the atomic batch — `{ to, data, value }`, all hex/decimal strings — ready to
 *  pass VERBATIM into a wallet's `wallet_sendCalls`. No ABI encoders or SDK needed on the client. */
export interface GaslessWireCall {
  /** Target contract (hex): the ERC20 for the `approve` leg, the SpokeAssetManager for the `transfer` leg. */
  to: string;
  /** Encoded calldata (hex). */
  data: string;
  /** Wei value as a decimal string (`'0'` for the ERC20 approve/transfer legs). */
  value: string;
}

/** EIP-5792 capabilities accompanying the {@link GaslessSwapBuildCallsResponse.calls} batch. */
export interface GaslessWireSendCallsCapabilities {
  /** Numeric EVM chain id — the wallet rejects `wallet_sendCalls` if its active chain differs. */
  chainId: number;
  /** The `[approve, transfer]` batch must execute atomically. */
  atomic: { status: 'required' };
  /**
   * ERC-7677 gas sponsorship. PRESENT only when the backend is configured with a CLIENT-SAFE paymaster —
   * an explicit per-chain `paymasterUrl` or a `paymasterProxyUrl` proxy — since its `url` is client-visible.
   * ABSENT when the only sponsorship source is a Pimlico API key (never exposed to a client): to enable
   * sponsored Mode A over HTTP the backend must run a paymaster proxy; without it the client would pay gas.
   */
  paymasterService?: { url: string; context?: Record<string, unknown> };
}

/** Result of {@link IGaslessSwapApi.buildSwapCalls} (Mode A). Gives a NON-SDK (pure-HTTP) consumer
 *  everything to drive EIP-5792 `wallet_sendCalls` in its own browser wallet: the encoded
 *  `[approve, transfer]` batch (`calls`) plus its `capabilities`. The client passes them straight through —
 *  `wallet_sendCalls({ calls, chainId: capabilities.chainId, capabilities })` — with no SDK or ABI encoders.
 *  `intent` + `relayData` are echoed into `completeSwap` after the wallet returns a spoke tx hash. */
export interface GaslessSwapBuildCallsResponse {
  /** The atomic EIP-5792 batch — the encoded `approve` then `SpokeAssetManager.transfer` (order matters). */
  calls: GaslessWireCall[];
  /** EIP-5792 capabilities for the `calls` batch (chain id, atomic requirement, optional sponsorship). */
  capabilities: GaslessWireSendCallsCapabilities;
  /** The built swap intent (all-string), echo into `completeSwap`. */
  intent: IntentResponseV2;
  /** `{ address, payload }`, echo into `completeSwap`. */
  relayData: RelayExtraDataResponseV2;
}

/** JSON-safe mirror of {@link SubmitTxRequestV2} with two deviations, both to stay all-string AND give the
 *  in-process brain what it needs to relay: `intent` is the all-string {@link IntentResponseV2} (vs the
 *  bigint `IntentRequestV2`), and `relayData` is the full `{ address, payload }` {@link RelayExtraDataResponseV2}
 *  (vs SubmitTxRequestV2's bare payload string) — the client echoes back what prepareSwap/buildSwapCalls
 *  returned. The HTTP client sends only `relayData.payload` when it forwards to `/swaps/submit-tx`. */
type _GaslessSwapCompleteBase = Omit<SubmitTxRequestV2, 'intent' | 'relayData'> & {
  intent: IntentResponseV2;
  relayData: RelayExtraDataResponseV2;
};

/** Request for {@link IGaslessSwapApi.completeSwap}. Also the anchor for the JSON-safety guard below. */
export type GaslessSwapCompleteRequest = _GaslessSwapCompleteBase &
  _AssertJsonSafe<[_ContainsBigint<_NewGaslessSwapWireShapes>] extends [false] ? true : false>;

/** Wire error codes for synchronous gasless-swap failures. Async completion failures surface via
 *  {@link SubmitTxStatusResponseV2} (`status: 'failed'`, `failureReason`, `abandonedAt`), NOT here. The
 *  runtime `isGaslessSwapApiErrorCode` guard lives in `@sodax/sdk` (like `isGaslessApiErrorCode`). */
export type GaslessSwapApiErrorCode = GaslessApiErrorCode | 'INTENT_BUILD_FAILED';

/** Swap-aware gasless contract: eligibility → (Mode B: prepare/submit | Mode A: build-calls) →
 *  server-side completion (relay + solver-notify) as a submit-then-poll pair. JSON-safe; implemented
 *  in-process by the brain (`sodax.gaslessSwap`) and over HTTP by `sodax.api.gaslessSwap`. */
export interface IGaslessSwapApi {
  /** Chain + EOA eligibility (chain gasless-configured, sender is an EOA, paymaster/bundler resolvable).
   *  Gate the UI before prepareSwap/buildSwapCalls. Does NOT gate the input token — native-token
   *  rejection surfaces at prepareSwap/buildSwapCalls. */
  getCapabilities(body: GaslessCapabilitiesRequest): Promise<GaslessCapabilitiesResponse>;

  /** Mode B: build the swap intent (hub to+data) + the sponsored `[approve, transfer]` UserOp; returns the
   *  sign material PLUS the intent + relayData the client carries into completeSwap. */
  prepareSwap(body: CreateIntentParamsV2): Promise<GaslessSwapPrepareResponse>;

  /** Mode B: attach the EOA signature(s) to the prepared UserOp and broadcast; returns the spoke tx hash.
   *  Broadcast-only — complete via completeSwap. */
  submitSwap(body: GaslessSubmitRequest): Promise<GaslessSubmitResponse>;

  /** Mode A: build the swap intent + return the ENCODED EIP-5792 `[approve, transfer]` batch (`calls`) plus
   *  its `capabilities`, so a non-SDK client passes them straight to `wallet_sendCalls` (the wallet step is
   *  inherently client-side), plus the intent + relayData for completeSwap. `capabilities.paymasterService`
   *  is present only when a client-safe paymaster is configured (proxy/explicit — never a Pimlico key). */
  buildSwapCalls(body: CreateIntentParamsV2): Promise<GaslessSwapBuildCallsResponse>;

  /** Both modes: hand the ALREADY-broadcast spoke tx (from submitSwap, or the Mode-A wallet sendCalls) to
   *  the server, which relays it to the hub + notifies the solver. Idempotent on (txHash, srcChainKey).
   *  The returned SubmitTxResponseV2 is only an ACCEPTANCE ack (`data.status: 'inserted' | 'duplicate'`),
   *  NOT swap success — a 2xx / `success: true` here means "accepted for processing" and the completion can
   *  still fail. Read the actual terminal outcome exclusively via {@link getSwapCompletionStatus}. */
  completeSwap(body: GaslessSwapCompleteRequest): Promise<SubmitTxResponseV2>;

  /** Both modes: poll the completion state machine
   *  (pending→relaying→relayed→posting_execution→posted_execution→solved|failed). TERMINAL =
   *  status==='solved' || status==='failed' || data.abandonedAt != null. On solved,
   *  data.result.dstIntentTxHash / intent_hash are set. */
  getSwapCompletionStatus(query: SubmitTxStatusQueryV2): Promise<SubmitTxStatusResponseV2>;
}

// ── Compile-time JSON-safety guard for the wire shapes ──
// The backendApiV2 helpers are non-exported (to avoid knip "unused export"), so we re-declare them here
// and attach the assertion to the exported+used `GaslessSwapCompleteRequest` (an `& unknown` identity that
// trips a constraint error if a bigint ever leaks into any covered shape → `pnpm checkTs` / `build` go red).
// Covers the three NEW shapes AND every other response IGaslessSwapApi returns, so the WHOLE wire surface
// is self-enforcing (a future bigint added to any of these fails checkTs), not just the new shapes.
type _NewGaslessSwapWireShapes =
  | GaslessSwapPrepareResponse
  | GaslessSwapBuildCallsResponse
  | _GaslessSwapCompleteBase
  | GaslessCapabilitiesResponse
  | GaslessSubmitResponse
  | SubmitTxResponseV2
  | SubmitTxStatusResponseV2;

/** True if `T` contains a `bigint` anywhere in its data shape. */
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

/** Resolves to `unknown` when `Ok` proves JSON-safety; otherwise the `Ok extends true` constraint fails. */
type _AssertJsonSafe<_Ok extends true> = unknown;
