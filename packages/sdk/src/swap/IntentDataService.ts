import { decodeAbiParameters, encodeAbiParameters, encodePacked } from 'viem';
import type { Hex } from '@sodax/types';
import { IntentDataType, type IntentData } from '../shared/types/intent-types.js';

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
 * Stateless utility for the `Intent.data` envelope layer.
 *
 * `Intent.data` carries zero or more typed entries (a partner-fee payload, a delivery payload, …).
 * This class owns how those entries are packed into bytes the on-chain `IntentDataLib` decodes and
 * how they are recovered back out, keeping the `ArrayData` codec ({@link ARRAY_DATA_ABI}) in one
 * place. The delivery payloads themselves are produced by `HookService`; this layer is agnostic to
 * their contents and simply folds them in alongside the fee.
 */
export class IntentDataService {
  private constructor() {}

  /**
   * Folds a partner-fee envelope and an optional delivery payload into the final `Intent.data`:
   * - Neither → `'0x'`.
   * - Exactly one → that single packed `[uint8 type, bytes payload]` envelope (byte-identical to a
   *   bare fee envelope, so a fee-only intent's `data` is unchanged and stays decode-stable).
   * - Both → a `TYPE_ARRAY` envelope wrapping `[FEE, DELIVERY]` entries.
   *
   * @param feeEnvelope - The packed fee envelope from `EvmSolverService.createIntentFeeData` (`'0x'` if no fee).
   * @param deliveryData - Opaque delivery payload (e.g. from `HookService.encodeDeliveryData`), or `undefined`.
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
    return IntentDataService.encodeIntentData(entries);
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
      `[IntentDataService.extractFeePayload] Unknown IntentData type byte: ${typeByte}. Gracefully returning no fee.`,
    );
    return undefined;
  }
}
