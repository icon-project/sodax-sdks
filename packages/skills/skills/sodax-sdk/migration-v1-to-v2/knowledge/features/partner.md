# Partner migration — v1 → v2

Pure-SDK migration playbook for `PartnerService`.

Pair: [`features/partner.md`](../../../integration/knowledge/features/partner.md).

## TL;DR

Standard pattern. Drop `spokeProvider`; pass `walletProvider`. Add `srcChainKey` + `srcAddress` to claim params. v1's 5 typed errors collapse into `SodaxError<C>` with `feature: 'partner'`.

## Type / symbol cheat sheet

| Type | v1 shape | v2 shape | Notes |
|---|---|---|---|
| Partner action params | non-generic | now generic `<K>` with `srcChainKey`, `srcAddress` | |
| Partner errors (5 types) | `PartnerFeeClaimError<...>` and 4 siblings | `SodaxError<C>` with `feature: 'partner'` | All 5 v1 typed errors collapse into `SodaxError`, but onto FOUR distinct codes (see crosswalk). |

## v1 → v2 error code crosswalk

The v1 partner errors collapse into `SodaxError<C>` with `feature: 'partner'`, but they do NOT all become `EXECUTION_FAILED`. The service emits FOUR distinct codes, with `error.context.action` (and `error.context.method` for reads) discriminating between the operations:

- `VALIDATION_FAILED` — same-token guard (output token equals the fee token) in `createIntentAutoSwap` / `swap`.
- `APPROVE_FAILED` — `approveToken` failure.
- `EXECUTION_FAILED` — the swap-wait / on-chain execution failure in the auto-swap flow.
- `LOOKUP_FAILED` — all read methods (`isTokenApproved`, `getUserIntent`, `getIntentDetails`, balance/preference reads, etc.).

## Per-method delta

Partner operations live on `sodax.partners.feeClaim` (a `PartnerFeeClaimService`), not directly on `sodax.partners`. v1 method names also changed:

```diff
- await sodax.partners.claimFees({ /* … */ }, spokeProvider);
+ // Approve once, then configure auto-swap preference, then run swaps.
+ // Full method list lives in integration/features/partner.md.
+ const approved = await sodax.partners.feeClaim.isTokenApproved({ srcChainKey, srcAddress, token });
+ if (approved.ok && !approved.value) {
+   await sodax.partners.feeClaim.approveToken({
+     params: { srcChainKey, srcAddress, token },
+     raw: false,
+     walletProvider,
+   });
+ }
```

## Pitfalls

1. **Partner methods moved.** They live on `sodax.partners.feeClaim`, not `sodax.partners` directly. The parent only exposes `feeClaim` and `config` as public fields.
2. **All 5 v1 partner errors collapse to `feature: 'partner'`.** They span four codes — `VALIDATION_FAILED`, `APPROVE_FAILED`, `EXECUTION_FAILED`, `LOOKUP_FAILED` — not a single `EXECUTION_FAILED`. Discriminate on `error.code` plus `error.context.action` / `error.context.method`.

## Verification

```bash
pnpm -C <your-app-dir> checkTs

# Targeted scans:
grep -rE "spokeProvider:\s*\w+|isPartnerError\b|PartnerFeeClaimError\b" src/
```

## Cross-references

- v2 partner usage: [`features/partner.md`](../../../integration/knowledge/features/partner.md).
- Stuck-asset recovery migration (separate service, new in v2): [`./recovery.md`](recovery.md).
- Backend API migration (the load-bearing `Result`-wrapping change): [`./backend-api.md`](backend-api.md).
- Result/error model: [`../breaking-changes/result-and-errors.md`](../breaking-changes/result-and-errors.md).
