/**
 * Tests for HookService — delivery-hook resolution + payload encoding for solver intents.
 *
 * Covers the public statics:
 *   - `encodeDeliveryData` — the single, type-differentiated payload encoder.
 *   - `resolveDeliveryHook` — registry lookup fused with the codec (address + payload together).
 *   - `resolveDelivery` — the CreateIntentParams entry point (hook vs. low-level pass-through).
 *   - `composeIntentData` / `encodeIntentData` / `extractFeePayload` — the intent-`data` envelope layer
 *     (fee + delivery folded into one packed/array envelope, and fee recovery back out).
 *
 * The hook registry (addresses) lives in `@sodax/types`; these tests assert against it via
 * `getSpokeHook` so a registry change is reflected rather than hard-coded here.
 */
import { describe, expect, it, vi } from 'vitest';
import { ChainKeys, HookKind, getSpokeHook, type Hex } from '@sodax/types';
import { decodeAbiParameters, encodeAbiParameters, encodePacked } from 'viem';
import { HookService } from './HookService.js';
import { EvmSolverService } from './EvmSolverService.js';
import { IntentDataType, type CreateIntentParams } from '../shared/types/intent-types.js';

const FEE_RECEIVER = '0xfee0fee0fee0fee0fee0fee0fee0fee0fee0fee0' as const;

const HC_RECIPIENT = '0x00000000000000000000000000000000000000Ad' as const;

describe('HookService.encodeDeliveryData', () => {
  it('encodes the HyperCore payload as abi.encode(address) (32 bytes)', () => {
    const encoded = HookService.encodeDeliveryData({ kind: HookKind.HYPERCORE_DEPOSIT }, HC_RECIPIENT);
    expect(encoded).toBe(encodeAbiParameters([{ name: 'recipient', type: 'address' }], [HC_RECIPIENT]));
    expect((encoded.length - 2) / 2).toBe(32);
  });

  it('throws on an unknown hook kind', () => {
    expect(() =>
      HookService.encodeDeliveryData(
        { kind: 'notAHook' } as unknown as { kind: typeof HookKind.HYPERCORE_DEPOSIT },
        HC_RECIPIENT,
      ),
    ).toThrow();
  });
});

describe('HookService.resolveDeliveryHook', () => {
  it('resolves the HyperCore hook to its registered address + encoded recipient', () => {
    const hook = getSpokeHook(ChainKeys.HYPEREVM_MAINNET, HookKind.HYPERCORE_DEPOSIT);
    const { dstAddress, deliveryData } = HookService.resolveDeliveryHook(
      ChainKeys.HYPEREVM_MAINNET,
      { kind: HookKind.HYPERCORE_DEPOSIT },
      HC_RECIPIENT,
    );

    expect(dstAddress).toBe(hook?.address);
    expect(deliveryData).toBe(HookService.encodeDeliveryData({ kind: HookKind.HYPERCORE_DEPOSIT }, HC_RECIPIENT));
  });

  it('throws when the requested hook is not deployed on the chain', () => {
    expect(() =>
      HookService.resolveDeliveryHook(ChainKeys.ETHEREUM_MAINNET, { kind: HookKind.HYPERCORE_DEPOSIT }, HC_RECIPIENT),
    ).toThrow();
  });
});

describe('HookService.resolveDelivery', () => {
  const base = (): CreateIntentParams => ({
    inputToken: '0x1111111111111111111111111111111111111111',
    outputToken: '0x2222222222222222222222222222222222222222',
    inputAmount: 1_000_000n,
    minOutputAmount: 0n,
    deadline: 0n,
    allowPartialFill: false,
    srcChainKey: ChainKeys.BSC_MAINNET,
    dstChainKey: ChainKeys.HYPEREVM_MAINNET,
    srcAddress: HC_RECIPIENT,
    dstAddress: HC_RECIPIENT,
    data: '0x',
  });

  it('passes through dstAddress + low-level deliveryData when no hook is set', () => {
    const params = { ...base(), deliveryData: '0xdeadbeef' as const };
    expect(HookService.resolveDelivery(params)).toEqual({ dstAddress: HC_RECIPIENT, deliveryData: '0xdeadbeef' });
  });

  it('overrides dstAddress with the hook and derives deliveryData when a hook is set', () => {
    const hook = getSpokeHook(ChainKeys.HYPEREVM_MAINNET, HookKind.HYPERCORE_DEPOSIT);
    const params = { ...base(), hook: { kind: HookKind.HYPERCORE_DEPOSIT } as const };

    expect(HookService.resolveDelivery(params)).toEqual({
      dstAddress: hook?.address,
      deliveryData: HookService.encodeDeliveryData({ kind: HookKind.HYPERCORE_DEPOSIT }, HC_RECIPIENT),
    });
  });
});

describe('HookService.composeIntentData', () => {
  // Arbitrary delivery payload, built via the common hook encoder.
  const hcDelivery = (recipient: string = HC_RECIPIENT): Hex =>
    HookService.encodeDeliveryData({ kind: HookKind.HYPERCORE_DEPOSIT }, recipient);

  it('returns "0x" when neither fee nor delivery is present', () => {
    expect(HookService.composeIntentData('0x', undefined)).toBe('0x');
    expect(HookService.composeIntentData('0x', '0x')).toBe('0x');
  });

  it('fee-only is byte-identical to the bare fee envelope (backward compat)', () => {
    const [feeEnvelope] = EvmSolverService.createIntentFeeData({ address: FEE_RECEIVER, amount: 5_000n }, 1_000_000n);
    expect(HookService.composeIntentData(feeEnvelope, undefined)).toBe(feeEnvelope);
  });

  it('delivery-only emits a single TYPE_DELIVERY envelope', () => {
    const delivery = hcDelivery();
    expect(HookService.composeIntentData('0x', delivery)).toBe(
      encodePacked(['uint8', 'bytes'], [IntentDataType.DELIVERY, delivery]),
    );
  });

  it('fee + delivery emits a TYPE_ARRAY envelope with both entries', () => {
    const [feeEnvelope] = EvmSolverService.createIntentFeeData({ address: FEE_RECEIVER, amount: 5_000n }, 1_000_000n);
    const delivery = hcDelivery();
    const data = HookService.composeIntentData(feeEnvelope, delivery);

    expect(data.slice(0, 4)).toBe(`0x0${IntentDataType.ARRAY}`); // 0x00 type byte

    const [arrayData] = decodeAbiParameters(
      [
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
      ],
      `0x${data.slice(4)}`,
    );
    const entries = arrayData.data as readonly { dataType: number; data: Hex }[];
    expect(entries.map(e => e.dataType)).toEqual([IntentDataType.FEE, IntentDataType.DELIVERY]);
    expect(entries[1]?.data).toBe(delivery);
  });
});

describe('HookService.extractFeePayload', () => {
  it('returns undefined for empty data', () => {
    expect(HookService.extractFeePayload('0x')).toBeUndefined();
  });

  it('returns undefined (no log) for a delivery-only envelope', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = HookService.composeIntentData(
      '0x',
      HookService.encodeDeliveryData({ kind: HookKind.HYPERCORE_DEPOSIT }, HC_RECIPIENT),
    );
    expect(HookService.extractFeePayload(data)).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('recovers the fee payload from a fee + delivery TYPE_ARRAY envelope', () => {
    const [feeEnvelope] = EvmSolverService.createIntentFeeData({ address: FEE_RECEIVER, amount: 1_234n }, 1_000_000n);
    const data = HookService.composeIntentData(feeEnvelope, hcDeliveryFixture());
    // The extracted payload is the bare fee envelope's payload (envelope minus the leading type byte).
    expect(HookService.extractFeePayload(data)).toBe(`0x${feeEnvelope.slice(4)}`);
  });

  it('logs and returns undefined for an unknown type byte', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bogus = encodePacked(['uint8', 'bytes'], [99, '0xdeadbeef']);
    expect(HookService.extractFeePayload(bogus)).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown IntentData type byte'));
  });
});

function hcDeliveryFixture(): Hex {
  return HookService.encodeDeliveryData({ kind: HookKind.HYPERCORE_DEPOSIT }, HC_RECIPIENT);
}
