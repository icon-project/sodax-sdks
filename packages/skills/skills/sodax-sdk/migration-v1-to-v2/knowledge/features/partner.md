# Partner migration — v1 → v2

Pure-SDK migration playbook for `PartnerService`.

Pair: [`features/partner.md`](../../../integration/knowledge/features/partner.md).

## TL;DR

Standard pattern. Drop `spokeProvider`; pass `walletProvider`. Add `srcChainKey` + `srcAddress` to claim params. v1's 5 typed errors collapse into `SodaxError<C>` with `feature: 'partner'`.

## Type / symbol cheat sheet

| Type | v1 shape | v2 shape | Notes |
|---|---|---|---|
| Partner action params | non-generic | now generic `<K>` with `srcChainKey`, `srcAddress` | |
| Partner errors (5 types) | `PartnerFeeClaimError<...>` and 4 siblings | `SodaxError<C>` with `feature: 'partner'` | All 5 v1 typed errors collapse. |

## v1 → v2 error code crosswalk

All 5 v1 partner error codes map to `EXECUTION_FAILED` with `error.context.action` discriminating between the operations.

## Per-method delta

Partner operations live on `sodax.partners.feeClaim` (a `PartnerFeeClaimService`), not directly on `sodax.partners`. v1 method names also changed:

```diff
- await sodax.partners.claimFees({ /* … */ }, spokeProvider);
+ // Approve once, then configure auto-swap preference, then run swaps.
+ // Full method list lives in integration/features/partner.md.
+ const approved = await sodax.partners.feeClaim.isTokenApproved({ token, srcAddress });
+ if (approved.ok && !approved.value) {
+   await sodax.partners.feeClaim.approveToken({
+     params: { token, amount },
+     raw: false,
+     walletProvider,
+   });
+ }
```

## Pitfalls

1. **Partner methods moved.** They live on `sodax.partners.feeClaim`, not `sodax.partners` directly. The parent only exposes `feeClaim` and `config` as public fields.
2. **All 5 v1 partner errors collapse to `feature: 'partner'`.** Even though they share the `EXECUTION_FAILED` code with every other feature.

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
