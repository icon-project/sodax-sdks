import { type Address, encodeAbiParameters } from 'viem';
import { HookKind, getSpokeHook, type Hex, type SpokeChainKey } from '@sodax/types';
import { invariant } from '../shared/utils/tiny-invariant.js';
import type { CreateIntentParams, HookRequest } from '../shared/types/intent-types.js';

/**
 * ABI parameter schemas for each delivery hook's `deliveryData` payload, keyed by {@link HookKind}.
 * Each entry is the exact `abi.encode(...)` shape the deployed hook's `hook(token, amount, deliveryData)`
 * decodes on the destination spoke. Add a new hook's schema here alongside its {@link HookKind}.
 */
const HOOK_DELIVERY_ABI = {
  // HyperCoreDepositHook expects `abi.encode(address)` — the HyperCore account to credit.
  [HookKind.HYPERCORE_DEPOSIT]: [{ name: 'recipient', type: 'address' }],
  // FlintDepositHook expects `abi.encode(address)` — the ERC-7540 controller the deposit request is
  // recorded against, i.e. the account that ends up owning the resulting flUSD shares. Same shape as
  // HyperCore's today; kept as its own entry so the two can diverge without touching each other.
  [HookKind.FLINT_DEPOSIT]: [{ name: 'recipient', type: 'address' }],
} as const satisfies Record<HookKind, readonly { name: string; type: string }[]>;

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
      case HookKind.FLINT_DEPOSIT:
        return encodeAbiParameters(HOOK_DELIVERY_ABI[HookKind.FLINT_DEPOSIT], [recipient as Address]);
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
}
