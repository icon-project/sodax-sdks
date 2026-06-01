# Partner — `PartnerService`

Partner-fee handling. `PartnerService` itself only exposes `feeClaim: PartnerFeeClaimService` and `config: ConfigService` as public fields. Every operation lives on `sodax.partners.feeClaim`.

Access: `sodax.partners`. Service class: `PartnerService` (operations on `sodax.partners.feeClaim`). Feature tag for errors: `'partner'`.

## Methods (all on `sodax.partners.feeClaim`)

```ts
// Token approval
sodax.partners.feeClaim.isTokenApproved({ token, srcAddress }): Promise<Result<boolean, Error>>;
sodax.partners.feeClaim.approveToken<Raw>(args): Promise<Result<TxReturnType, Error>>;

// Auto-swap preferences (whether partner-collected fees auto-swap into a target asset)
sodax.partners.feeClaim.getAutoSwapPreferences(queryAddress): Promise<Result<AutoSwapPreferences, Error>>;
sodax.partners.feeClaim.setSwapPreference<K, Raw>(args): Promise<Result<TxReturnType, Error>>;

// Fee claim flows
sodax.partners.feeClaim.swap(args): Promise<Result<...>>;                           // immediate fee swap
sodax.partners.feeClaim.createIntentAutoSwap<Raw>(args): Promise<Result<...>>;       // intent-driven auto-swap

// Reads
sodax.partners.feeClaim.fetchAssetsBalances(args): Promise<Result<...>>;
sodax.partners.feeClaim.getOriginalAssetAddress(chainId, hubAsset): OriginalAssetAddress | undefined;
sodax.partners.feeClaim.getSpokeTokenFromOriginalAssetAddress(...): /* … */;
```

## Common call shape

```ts
// 1. Check whether the partner's fee token is approved on the hub:
const approved = await sodax.partners.feeClaim.isTokenApproved({
  token: '0x…',         // hub asset address
  srcAddress: partnerAddress,
});

// 2. Approve once if not:
if (approved.ok && !approved.value) {
  await sodax.partners.feeClaim.approveToken({
    params: { token: '0x…', amount: 2n ** 256n - 1n },
    raw: false,
    walletProvider: sonicWp,
  });
}

// 3. Configure auto-swap preference (one-time):
await sodax.partners.feeClaim.setSwapPreference({
  params: { /* preference fields */ },
  raw: false,
  walletProvider: sonicWp,
});
```

## Error codes

`feature: 'partner'`. Action methods get the full exec set; reads get `LookupErrorCode` partitioned by `error.context.method`.

## Cross-references

- v1 → v2 migration of `PartnerService`: [`features/partner.md`](../../../migration-v1-to-v2/knowledge/features/partner.md).
- Hub-wallet asset recovery (separate service): [`./recovery.md`](recovery.md).
- Backend HTTP client (separate service): [`./backend-api.md`](backend-api.md).
- Error model context fields (`error.context.api`, `error.context.method`): [`../reference/`](../reference/) § 3.
