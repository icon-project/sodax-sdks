import { HookKind } from '@sodax/dapp-kit';

// Shared by both swap panels (`components/swaps` drives the SDK directly, `components/swaps-api`
// goes through the Swaps API), so a newly registered hook needs one label, not one per panel.
//
// Typed as a total Record so registering a new `HookKind` fails to compile here until it gets a
// label, rather than silently rendering an unlabelled checkbox.
export const HOOK_LABELS: Record<HookKind, string> = {
  [HookKind.HYPERCORE_DEPOSIT]: 'Deposit to HyperCore (perps)',
  [HookKind.FLINT_DEPOSIT]: 'Deposit to Flint (RWA vault)',
};

// The SDK's `HookRequest` is a discriminated union, so a widened `HookKind` is not assignable to it
// directly. Switching per kind keeps that type-safe without a cast, and a new kind becomes a compile
// error. (The wire type `HookRequestV2` is a plain `{ kind: HookKind }` and needs no such helper.)
export const toHookRequest = (kind: HookKind) => {
  switch (kind) {
    case HookKind.HYPERCORE_DEPOSIT:
      return { kind: HookKind.HYPERCORE_DEPOSIT } as const;
    case HookKind.FLINT_DEPOSIT:
      return { kind: HookKind.FLINT_DEPOSIT } as const;
  }
};
