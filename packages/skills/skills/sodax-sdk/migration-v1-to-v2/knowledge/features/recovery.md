# Recovery migration — v1 → v2

Pure-SDK migration playbook for `RecoveryService`.

Pair: [`features/recovery.md`](../../../integration/knowledge/features/recovery.md).

## TL;DR

**`RecoveryService` is new in v2.** No v1 equivalent — there's no migration to do for code that didn't exist before. This file exists so the v1 → v2 audit doesn't miss the addition.

If you have v1 code that worked around the absence (e.g. manually walked the hub wallet abstraction to find stuck assets), replace it with `fetchHubAssetBalances` + `withdrawHubAsset`:

```ts
const balances = await sodax.recovery.fetchHubAssetBalances({ /* user / hub-wallet args */ });
if (balances.ok && balances.value.length > 0) {
  await sodax.recovery.withdrawHubAsset({
    params: { /* hub-asset address, amount, destination spoke chain + address */ },
    raw: false,
    walletProvider: sonicWp,
  });
}
```

See [`features/recovery.md`](../../../integration/knowledge/features/recovery.md) for the full method signatures and error codes.

## Pitfalls

1. **Recovery is not a replacement for real error handling.** Use it after investigating why the original cross-chain operation failed — relay timeouts may resolve on retry; structural failures need fixing first.

## Cross-references

- v2 recovery usage: [`features/recovery.md`](../../../integration/knowledge/features/recovery.md).
- Partner migration (separate service): [`./partner.md`](partner.md).
- Backend API migration (separate service): [`./backend-api.md`](backend-api.md).
- Result/error model: [`../breaking-changes/result-and-errors.md`](../breaking-changes/result-and-errors.md).
