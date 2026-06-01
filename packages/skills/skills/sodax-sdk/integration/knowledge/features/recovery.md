# Recovery — `RecoveryService`

Withdraw stuck assets from a user's hub-wallet abstraction back to a spoke chain. Useful when a cross-chain operation deposited to the hub but the destination step failed (e.g. relay timeout after the spoke tx landed).

Access: `sodax.recovery`. Service class: `RecoveryService`. Feature tag for errors: `'recovery'`.

## Methods

```ts
// Read: list balances of all known hub assets in a user's hub wallet abstraction.
sodax.recovery.fetchHubAssetBalances(args): Promise<Result<HubAssetBalance[], SodaxError>>;

// Mutation: withdraw a single hub asset back to a spoke chain.
// Returns a tx-pair when raw: false (the hub-side spend + the relayed spoke-side receive).
sodax.recovery.withdrawHubAsset<K extends SpokeChainKey, Raw extends boolean>(
  action: WithdrawHubAssetAction<K, Raw>,
): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;
```

## Common call shape

```ts
// 1. Find what's stuck on the hub for this user:
const balances = await sodax.recovery.fetchHubAssetBalances({ /* user / hub-wallet args */ });
if (!balances.ok || balances.value.length === 0) return;

// 2. Withdraw one entry back to a spoke chain:
const result = await sodax.recovery.withdrawHubAsset({
  params: {
    /* hub-asset address, amount, destination spoke chain key, destination address */
  },
  raw: false,
  walletProvider: sonicWp,
});
```

## Error codes

`feature: 'recovery'`. The mutation method returns the full exec set (including relay codes); the read method returns `LookupErrorCode` partitioned by `error.context.method`.

## When to use

Recovery is a workaround for failed cross-chain operations. Best used **after** investigating why the original operation failed — relay timeouts may resolve on retry; structural failures need fixing first.

## Cross-references

- v1 → v2 migration of `RecoveryService`: [`features/recovery.md`](../../../migration-v1-to-v2/knowledge/features/recovery.md) (note: service is new in v2 — no v1 equivalent).
- Partner-fee handling (separate service): [`./partner.md`](partner.md).
- Backend HTTP client (separate service): [`./backend-api.md`](backend-api.md).
- Error model context fields: [`../reference/`](../reference/) § 3.
