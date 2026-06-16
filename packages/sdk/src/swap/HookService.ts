import { type Address, decodeAbiParameters, encodeAbiParameters, encodePacked } from 'viem';
import { HookKind, getSpokeHook, type Hex, type SpokeChainKey } from '@sodax/types';
import { invariant } from '../shared/utils/tiny-invariant.js';
import {
  IntentDataType,
  type CreateIntentParams,
  type HookRequest,
  type IntentData,
} from '../shared/types/intent-types.js';

/**
 * ABI parameter schemas for each delivery hook's `deliveryData` payload, keyed by {@link HookKind}.
 * Each entry is the exact `abi.encode(...)` shape the deployed hook's `hook(token, amount, deliveryData)`
 * decodes on the destination spoke. Add a new hook's schema here alongside its {@link HookKind}.
 */
const HOOK_DELIVERY_ABI = {
  // HyperCoreDepositHook expects `abi.encode(address)` — the HyperCore account to credit.
  [HookKind.HYPERCORE_DEPOSIT]: [{ name: 'recipient', type: 'address' }],
} as const satisfies Record<HookKind, readonly { name: string; type: string }[]>;

/**
 * ABI for the on-chain `ArrayData { DataEntry[] data }` envelope used when an intent's `data` carries
 * more than one typed entry (e.g. fee + delivery). Mirrors `IntentDataLib`'s `abi.decode(data, (ArrayData))`
 * where `DataEntry = { uint8 dataType, bytes data }`.
 */
const ARRAY_DATA_ABI = [
  {
    type: 'tuple',
    components: [
      {
        name: 'data',
        type: 'tuple[]',
        components: [
          { name: 'dataType', type: 'uint8' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
  },
] as const;

/**
 * Stateless utility for the SODAX solver's delivery hooks.
 *
 * A delivery hook lets an intent's output be handed to `ISpokeReceiver(dstAddress).hook(...)` on the
 * destination spoke instead of transferred straight to the recipient. Each hook is two coupled things:
 * its **deployed address** (the registry in `@sodax/types`) and its **`deliveryData` codec** (here).
 * This class fuses them so the address and payload can never drift, and exposes a single
 * type-differentiated {@link encodeDeliveryData} rather than one encoder per hook.
 */
export class HookService {
  private constructor() {}

  /**
   * Encodes a hook's `deliveryData` payload. One common entry point for all hooks — the encoding is
   * selected by {@link HookRequest.kind} and uses that hook's schema from {@link HOOK_DELIVERY_ABI}.
   *
   * @param request - The hook selection (and any hook-specific params).
   * @param recipient - The end recipient the hook should credit (the intent's `dstAddress`).
   */
  public static encodeDeliveryData(request: HookRequest, recipient: string): Hex {
    switch (request.kind) {
      case HookKind.HYPERCORE_DEPOSIT:
        return encodeAbiParameters(HOOK_DELIVERY_ABI[HookKind.HYPERCORE_DEPOSIT], [recipient as Address]);
    }
    // Reached only if a HookKind gains a HookRequest member without a case above — add one here.
    throw new Error(
      `[HookService.encodeDeliveryData] Unsupported delivery hook kind: ${(request as { kind: string }).kind}`,
    );
  }

  /**
   * Resolves a high-level {@link HookRequest} to the on-chain delivery pair: the deployed hook address
   * (becomes the intent's `dstAddress`) and the encoded payload the hook expects (`deliveryData`).
   * Bundling lookup + codec here guarantees the address and its payload schema can never drift.
   *
   * @param chainKey - Destination spoke chain (must have the requested hook deployed).
   * @param request - The hook selection (and any hook-specific params).
   * @param recipient - The end recipient the hook should credit (the intent's `dstAddress`).
   */
  public static resolveDeliveryHook(
    chainKey: SpokeChainKey,
    request: HookRequest,
    recipient: string,
  ): { dstAddress: Address; deliveryData: Hex } {
    const hook = getSpokeHook(chainKey, request.kind);
    invariant(hook, `No '${request.kind}' delivery hook is deployed on chain ${chainKey}`);

    return { dstAddress: hook.address, deliveryData: HookService.encodeDeliveryData(request, recipient) };
  }

  /**
   * Resolves the effective delivery target for an intent. When {@link CreateIntentParams.hook} is set,
   * routes the output through that registered hook (overriding `dstAddress` and deriving `deliveryData`);
   * otherwise returns the caller's `dstAddress` and low-level `deliveryData` unchanged. Centralised so
   * both the hub and Sonic intent constructors apply hooks identically.
   *
   * @returns `{ dstAddress, deliveryData }` — the address to deliver to and the payload to forward.
   */
  public static resolveDelivery(params: CreateIntentParams): { dstAddress: string; deliveryData: Hex | undefined } {
    if (!params.hook) {
      return { dstAddress: params.dstAddress, deliveryData: params.deliveryData };
    }
    return HookService.resolveDeliveryHook(params.dstChainKey, params.hook, params.dstAddress);
  }

  /**
   * Folds a partner-fee envelope and an optional delivery payload into the final `Intent.data`:
   * - Neither → `'0x'`.
   * - Exactly one → that single packed `[uint8 type, bytes payload]` envelope (byte-identical to a
   *   bare fee envelope, so a fee-only intent's `data` is unchanged and stays decode-stable).
   * - Both → a `TYPE_ARRAY` envelope wrapping `[FEE, DELIVERY]` entries.
   *
   * @param feeEnvelope - The packed fee envelope from `EvmSolverService.createIntentFeeData` (`'0x'` if no fee).
   * @param deliveryData - Opaque delivery payload (e.g. {@link encodeDeliveryData}), or `undefined`.
   */
  public static composeIntentData(feeEnvelope: Hex, deliveryData?: Hex): Hex {
    const entries: IntentData[] = [];
    if (feeEnvelope !== '0x') {
      // Recover the raw fee payload from the packed envelope (strip the leading type byte).
      entries.push({ type: IntentDataType.FEE, data: `0x${feeEnvelope.slice(4)}` });
    }
    if (deliveryData && deliveryData !== '0x') {
      entries.push({ type: IntentDataType.DELIVERY, data: deliveryData });
    }
    return HookService.encodeIntentData(entries);
  }

  /**
   * Encodes a list of typed `IntentData` entries into the `Intent.data` bytes the contract decodes.
   * Empty → `'0x'`; single → a packed `[uint8 type, bytes payload]` envelope; multiple → a `TYPE_ARRAY`
   * envelope wrapping the entries as `ArrayData { DataEntry[] }`.
   */
  public static encodeIntentData(entries: IntentData[]): Hex {
    if (entries.length === 0) {
      return '0x';
    }
    const [first] = entries;
    if (first && entries.length === 1) {
      return encodePacked(['uint8', 'bytes'], [first.type, first.data]);
    }
    const encodedArray = encodeAbiParameters(ARRAY_DATA_ABI, [
      { data: entries.map(e => ({ dataType: e.type, data: e.data })) },
    ]);
    return encodePacked(['uint8', 'bytes'], [IntentDataType.ARRAY, encodedArray]);
  }

  /**
   * Extracts the raw `FeeData` payload (`abi.encode(uint256 fee, address receiver)`) from an intent's
   * `data`, unwrapping whichever envelope shape it uses. Returns `undefined` when there is no fee:
   * empty `data`, a delivery-only envelope, or an unknown type byte (logged). Used by
   * `EvmSolverService.decodeIntentFeeAmount` to recover fees regardless of delivery data.
   */
  public static extractFeePayload(data: Hex): Hex | undefined {
    if (data === '0x' || data.length <= 2) {
      return undefined;
    }

    // encodePacked(['uint8', 'bytes'], …) prepends a single type byte (2 hex chars).
    const typeByte = Number.parseInt(data.slice(2, 4), 16);

    if (typeByte === IntentDataType.FEE) {
      return `0x${data.slice(4)}`;
    }

    // TYPE_ARRAY envelope (e.g. fee + delivery): find the FEE entry's payload.
    if (typeByte === IntentDataType.ARRAY) {
      const [arrayData] = decodeAbiParameters(ARRAY_DATA_ABI, `0x${data.slice(4)}`);
      return arrayData.data.find(e => e.dataType === IntentDataType.FEE)?.data;
    }

    // Delivery-only is a known shape that carries no fee — silent.
    if (typeByte === IntentDataType.DELIVERY) {
      return undefined;
    }

    console.error(
      `[HookService.extractFeePayload] Unknown IntentData type byte: ${typeByte}. Gracefully returning no fee.`,
    );
    return undefined;
  }
}
