import type {
  Address,
  CreateIntentParamsV2,
  EvmSpokeOnlyChainKey,
  GaslessCapabilitiesRequest,
  GaslessCapabilitiesResponse,
  GaslessSubmitRequest,
  GaslessSubmitResponse,
  GaslessSwapBuildCallsResponse,
  GaslessSwapCompleteRequest,
  GaslessSwapPrepareResponse,
  Hex,
  HubAddress,
  IGaslessSwapApi,
  IntentResponseV2,
  PartnerFee,
  PartnerFeeV2,
  Result,
  SpokeChainKey,
  SubmitTxResponseV2,
  SubmitTxStatusDataV2,
  SubmitTxStatusQueryV2,
  SubmitTxStatusResponseV2,
} from '@sodax/types';
import type { Resultified } from '../backendApi/api-utils.js';
import { SodaxError, isSodaxError } from '../errors/SodaxError.js';
import { messageOf, unknownFailed } from '../errors/wrappers.js';
import type { GaslessService } from '../gasless/GaslessService.js';
import type { CreateIntentParams, Intent, SwapExtras, SwapService } from '../swap/SwapService.js';
import type { RelayExtraData } from '../shared/types/types.js';

export type GaslessSwapServiceConstructorParams = {
  swaps: SwapService;
  gasless: GaslessService;
};

/**
 * In-process brain for gasless SWAPS — composes {@link SwapService} (`createIntent`, `postExecution`) and
 * {@link GaslessService} (`getCapabilities`, `prepare`, `submit`, `relay`, `buildSendCalls`) into the swap-aware
 * {@link IGaslessSwapApi} seam. Reachable as `sodax.gaslessSwap`; the HTTP client `sodax.api.gaslessSwap`
 * satisfies the same seam. Takes/returns the JSON-safe wire DTOs (string amounts) exactly like the backend.
 *
 * The seam is HTTP-facing (a backend forwards untrusted client bodies), so every public method returns a
 * `Result<T>` and NEVER throws — malformed wire input (a non-integer amount string, a missing `relayData`)
 * is surfaced as `VALIDATION_FAILED`, exactly like the sibling {@link GaslessService} methods.
 *
 * Both modes converge on {@link completeSwap} → {@link getSwapCompletionStatus}. The brain runs the
 * completion (relay → hub, then notify the solver) SYNCHRONOUSLY to a terminal state and stores it — no
 * background work — so the first poll already returns `solved`/`failed`. Mode A's wallet-bound `sendCalls`
 * is off this interface (a brain-only call on `sodax.gasless`); {@link buildSwapCalls} returns the inputs it needs.
 */
export class GaslessSwapService implements Resultified<IGaslessSwapApi> {
  private readonly swaps: SwapService;
  private readonly gasless: GaslessService;
  /** Completion records keyed by `${srcChainKey}:${txHash}` — an in-flight `relaying` marker, then the
   *  terminal `solved`/`failed` record (in-process mirror of the backend worker). */
  private readonly completions = new Map<string, SubmitTxStatusDataV2>();

  constructor({ swaps, gasless }: GaslessSwapServiceConstructorParams) {
    this.swaps = swaps;
    this.gasless = gasless;
  }

  /** Chain + EOA eligibility (delegates to the feature-agnostic gasless brain). */
  public getCapabilities(body: GaslessCapabilitiesRequest): Promise<Result<GaslessCapabilitiesResponse>> {
    return this.gasless.getCapabilities(body);
  }

  /** Mode B: build the swap intent (raw, no broadcast) + the sponsored UserOp; return sign material + the
   *  intent + relayData the client carries into {@link completeSwap}. */
  public async prepareSwap(body: CreateIntentParamsV2): Promise<Result<GaslessSwapPrepareResponse>> {
    const built = await this.buildRawIntent(body);
    if (!built.ok) return built;
    const { intent, relayData } = built.value;

    const prepared = await this.gasless.prepare({
      srcChainKey: body.srcChainKey,
      srcAddress: body.srcAddress,
      token: body.inputToken,
      amount: body.inputAmount,
      to: relayData.address,
      data: relayData.payload,
    });
    if (!prepared.ok) return prepared;

    return {
      ok: true,
      value: {
        prepared: prepared.value,
        intent: toIntentResponseV2(intent),
        relayData: { address: relayData.address, payload: relayData.payload },
      },
    };
  }

  /** Mode B: broadcast the signed UserOp (delegates to the gasless brain). Complete via {@link completeSwap}. */
  public submitSwap(body: GaslessSubmitRequest): Promise<Result<GaslessSubmitResponse>> {
    return this.gasless.submit(body);
  }

  /** Mode A: build the swap intent (raw), then have the gasless brain encode the sponsored `[approve, transfer]`
   *  EIP-5792 batch + capabilities so a NON-SDK (pure-HTTP) client can call its wallet's `wallet_sendCalls`
   *  directly (the wallet step is inherently client-side). Returns the batch + intent + relayData for
   *  {@link completeSwap}. The paymaster is exposed only when client-safe (proxy/explicit — never a Pimlico key). */
  public async buildSwapCalls(body: CreateIntentParamsV2): Promise<Result<GaslessSwapBuildCallsResponse>> {
    const built = await this.buildRawIntent(body);
    if (!built.ok) return built;
    const { intent, relayData } = built.value;

    // `body.inputAmount` was proven an integer string by buildRawIntent, so this BigInt cannot throw.
    const encoded = await this.gasless.buildSendCalls({
      srcChainKey: body.srcChainKey as EvmSpokeOnlyChainKey,
      srcAddress: body.srcAddress as Address,
      token: body.inputToken as Address,
      amount: BigInt(body.inputAmount),
      to: relayData.address as HubAddress,
      data: relayData.payload,
    });
    if (!encoded.ok) return encoded;

    return {
      ok: true,
      value: {
        calls: encoded.value.calls.map(call => ({ to: call.to, data: call.data, value: call.value.toString() })),
        capabilities: {
          chainId: encoded.value.chainId,
          atomic: { status: 'required' },
          ...(encoded.value.paymaster ? { paymasterService: encoded.value.paymaster } : {}),
        },
        intent: toIntentResponseV2(intent),
        relayData: { address: relayData.address, payload: relayData.payload },
      },
    };
  }

  /** Both modes: relay the already-broadcast spoke tx to the hub, then notify the solver — run to a terminal
   *  state and stored for {@link getSwapCompletionStatus}. Idempotent on `(txHash, srcChainKey)`, including
   *  CONCURRENT same-key calls: the key is reserved synchronously (before the relay await) so a second call
   *  dedups to `duplicate` rather than relaying the spoke tx twice. Returns the submit-tx ack (`inserted`
   *  first time, `duplicate` on replay); the actual outcome is read via {@link getSwapCompletionStatus}. */
  public async completeSwap(body: GaslessSwapCompleteRequest): Promise<Result<SubmitTxResponseV2>> {
    if (!isNonEmptyString(body.txHash) || !isNonEmptyString(body.srcChainKey)) {
      return { ok: false, error: validationFailed('txHash', 'txHash and srcChainKey are required') };
    }
    if (!body.relayData || !isNonEmptyString(body.relayData.address) || !isNonEmptyString(body.relayData.payload)) {
      return { ok: false, error: validationFailed('relayData', 'relayData.address and relayData.payload are required') };
    }

    const key = completionKey(body.srcChainKey, body.txHash);
    if (this.completions.has(key)) {
      return { ok: true, value: { success: true, data: { status: 'duplicate', message: 'Already processed' } } };
    }
    // Every stored record shares the same `(txHash, srcChainKey, processingAttempts)` prefix; `record` fills it
    // so each `set` below names only its distinguishing fields.
    const record = (fields: Omit<SubmitTxStatusDataV2, 'txHash' | 'srcChainKey' | 'processingAttempts'>): void => {
      this.completions.set(key, { txHash: body.txHash, srcChainKey: body.srcChainKey, processingAttempts: 1, ...fields });
    };

    // Reserve the key SYNCHRONOUSLY (before the first await) so a concurrent same-(txHash,srcChainKey) call
    // sees it and dedups to `duplicate` instead of relaying the spoke tx a second time. This `relaying`
    // record is also the in-flight state getSwapCompletionStatus reports until a terminal record replaces it.
    record({ status: 'relaying' });

    try {
      const relayed = await this.gasless.relay({
        srcChainKey: body.srcChainKey as EvmSpokeOnlyChainKey,
        srcChainTxHash: body.txHash,
        relayData: { address: body.relayData.address as Hex, payload: body.relayData.payload as Hex },
      });
      if (!relayed.ok) {
        record({ status: 'failed', failedAtStep: 'relaying', failureReason: messageOf(relayed.error, 'Relay failed') });
        return acceptedAck();
      }

      const dstIntentTxHash = relayed.value.dstChainTxHash;
      const postExec = await this.swaps.postExecution({ intent_tx_hash: dstIntentTxHash as Hex });
      record(
        postExec.ok
          ? { status: 'solved', result: { dstIntentTxHash, intent_hash: postExec.value.intent_hash } }
          : {
              status: 'failed',
              failedAtStep: 'posting_execution',
              failureReason: messageOf(postExec.error, 'Post-execution failed'),
              result: { dstIntentTxHash },
            },
      );
      return acceptedAck();
    } catch (error) {
      record({ status: 'failed', failureReason: messageOf(error, 'Completion failed') });
      return { ok: false, error: toBrainError(error) };
    }
  }

  /** Both modes: read the stored completion state. Since the brain completes synchronously, the first poll
   *  already returns a terminal `solved`/`failed`. Unknown `(txHash, srcChainKey)` → `success: false`. */
  public getSwapCompletionStatus(query: SubmitTxStatusQueryV2): Promise<Result<SubmitTxStatusResponseV2>> {
    const data = this.completions.get(completionKey(query.srcChainKey, query.txHash));
    if (!data) {
      return Promise.resolve({
        ok: true,
        value: {
          success: false,
          data: { txHash: query.txHash, srcChainKey: query.srcChainKey, status: 'pending', processingAttempts: 0 },
        },
      });
    }
    return Promise.resolve({ ok: true, value: { success: true, data } });
  }

  /** Validate the numeric wire fields, convert to domain params, and build the raw swap intent — the shared
   *  prefix of {@link prepareSwap}/{@link buildSwapCalls}. Returns a `Result` (never throws): a malformed
   *  amount/deadline is a `VALIDATION_FAILED` rather than a rejected promise from an unguarded `BigInt()`. */
  private async buildRawIntent(
    body: CreateIntentParamsV2,
  ): Promise<Result<{ intent: Intent; relayData: RelayExtraData }>> {
    for (const field of ['inputAmount', 'minOutputAmount', 'deadline'] as const) {
      if (!isIntegerString(body[field])) {
        return { ok: false, error: validationFailed(field, `${field} must be a base-unit integer string`) };
      }
    }
    if (body.partnerFee && 'amount' in body.partnerFee && !isIntegerString(body.partnerFee.amount)) {
      return { ok: false, error: validationFailed('partnerFee.amount', 'partnerFee.amount must be an integer string') };
    }
    try {
      const created = await this.swaps.createIntent({ params: fromCreateIntentParamsV2(body), raw: true, extras: toExtras(body) });
      if (!created.ok) return created;
      return { ok: true, value: { intent: created.value.intent, relayData: created.value.relayData } };
    } catch (error) {
      return { ok: false, error: toBrainError(error) };
    }
  }
}

const completionKey = (srcChainKey: string, txHash: string): string => `${srcChainKey}:${txHash}`;

/** A base-unit / timestamp wire field `BigInt()` can consume without throwing (a non-negative integer string). */
const isIntegerString = (value: unknown): value is string => typeof value === 'string' && /^\d+$/.test(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** `VALIDATION_FAILED` for a malformed wire field; `toGaslessSwapApiErrorCode` maps it to a gasless wire code. */
const validationFailed = (field: string, message: string): SodaxError =>
  new SodaxError('VALIDATION_FAILED', message, { feature: 'gasless', context: { field } });

/** Backstop: turn any thrown value into a `Result` error so the brain never rejects (mirrors GaslessService). */
const toBrainError = (error: unknown): SodaxError => (isSodaxError(error) ? error : unknownFailed('gasless', error));

const acceptedAck = (): Result<SubmitTxResponseV2> => ({
  ok: true,
  value: { success: true, data: { status: 'inserted', message: 'Accepted' } },
});

/** Project the domain `Intent` (bigint numerics + `feeAmount`) to the all-string wire `IntentResponseV2`
 *  (drops `feeAmount`; stringifies the six bigint fields). Never an `as` cast — that would leak bigint. */
function toIntentResponseV2(intent: Intent): IntentResponseV2 {
  return {
    intentId: intent.intentId.toString(),
    creator: intent.creator,
    inputToken: intent.inputToken,
    outputToken: intent.outputToken,
    inputAmount: intent.inputAmount.toString(),
    minOutputAmount: intent.minOutputAmount.toString(),
    deadline: intent.deadline.toString(),
    allowPartialFill: intent.allowPartialFill,
    srcChain: intent.srcChain.toString(),
    dstChain: intent.dstChain.toString(),
    srcAddress: intent.srcAddress,
    dstAddress: intent.dstAddress,
    solver: intent.solver,
    data: intent.data,
  };
}

/** Convert the JSON-safe {@link CreateIntentParamsV2} (string amounts) to the domain {@link CreateIntentParams} (bigint).
 *  Callers MUST validate the numeric strings (see {@link isIntegerString}) first — the `BigInt()` calls here throw on a
 *  malformed string. */
function fromCreateIntentParamsV2(body: CreateIntentParamsV2): CreateIntentParams {
  return {
    inputToken: body.inputToken,
    outputToken: body.outputToken,
    inputAmount: BigInt(body.inputAmount),
    minOutputAmount: BigInt(body.minOutputAmount),
    deadline: BigInt(body.deadline),
    allowPartialFill: body.allowPartialFill,
    srcChainKey: body.srcChainKey as SpokeChainKey,
    dstChainKey: body.dstChainKey as SpokeChainKey,
    srcAddress: body.srcAddress,
    dstAddress: body.dstAddress,
    solver: body.solver as Address | undefined,
    data: (body.data ?? '0x') as Hex,
  };
}

/** Build the swap `extras` from the request's optional `partnerFee` (gasless is EVM-only, so the Stacks/Bitcoin
 *  extras slots never apply). `undefined` when no per-request fee override is supplied. */
function toExtras(body: CreateIntentParamsV2): SwapExtras | undefined {
  if (!body.partnerFee) return undefined;
  return { partnerFee: fromPartnerFeeV2(body.partnerFee) };
}

function fromPartnerFeeV2(fee: PartnerFeeV2): PartnerFee {
  const address = fee.address as Address;
  return 'amount' in fee ? { address, amount: BigInt(fee.amount) } : { address, percentage: fee.percentage };
}
