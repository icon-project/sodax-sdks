# Token migration — `MigrationService`

Migration of legacy ICON ecosystem tokens to the SODAX hub. Three sub-services:

- **`IcxMigrationService`** — ICX/wICX → SODA (forward) and SODA → ICX (revert).
- **`BnUSDMigrationService`** — legacy bnUSD (ICON / Sui / Stellar) ↔ new bnUSD (EVM chains) via vault transformations.
- **`BalnSwapService`** — BALN → SODA with lockup periods (0–24 months) that multiply rewards (0.5x–1.5x).

Access: `sodax.migration`. Service class: `MigrationService` (with sub-services `sodax.migration.icxMigration`, `sodax.migration.bnUSDMigrationService`, `sodax.migration.balnSwapService`). Feature tag for errors: `'migration'`.

> Don't confuse this feature (the `MigrationService` SDK module) with the v1 → v2 SDK port itself. They share the word "migration" but are independent concerns. The v1 → v2 port playbook lives at [`../../migration/features/icx-bnusd-baln.md`](../../migration/features/icx-bnusd-baln.md).

## How it works

All three sub-services follow the same pattern: deposit on a spoke chain → relay to hub → execute hub-side migration contract → deliver new token.

`MigrationService` exposes 11 async public methods:

- 4 orchestrators (full execution): `migratebnUSD`, `migrateIcxToSoda`, `revertMigrateSodaToIcx`, `migrateBaln`.
- 4 intent creators (raw or signed spoke tx, no full lifecycle): `createMigrateBnUSDIntent`, `createMigrateIcxToSodaIntent`, `createRevertMigrateSodaToIcxIntent`, `createMigrateBalnIntent`.
- `approve`, `isAllowanceValid` (action-discriminated like staking and money market).
- `getAvailableAmount` (read-only; `IcxMigrationService` only — checks how much SODA the user can claim from a partial migration).

`BalnSwapService` has additional lock-management methods that **still throw** (do not return `Result<T>`): `claim`, `claimUnstaked`, `stake`, `unstake`, `cancelUnstake`, `getDetailedUserLocks`. This is deliberate tech debt; future cleanup. Wrap them in `try/catch` until then.

## Public methods

```ts
sodax.migration.migratebnUSD<K>(action): Promise<Result<TxHashPair, SodaxError>>;
sodax.migration.migrateIcxToSoda<K>(action): Promise<Result<TxHashPair, SodaxError>>;
sodax.migration.revertMigrateSodaToIcx<K>(action): Promise<Result<TxHashPair, SodaxError>>;
sodax.migration.migrateBaln<K>(action): Promise<Result<TxHashPair, SodaxError>>;

sodax.migration.createMigrateBnUSDIntent<K, Raw>(...): Promise<Result<...>>;
// + 3 other createXxxIntent methods

sodax.migration.approve<K, Raw>(args): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;
sodax.migration.isAllowanceValid<K, Raw>(args): Promise<Result<boolean, SodaxError>>;

sodax.migration.icxMigration.getAvailableAmount(): Promise<Result<bigint, SodaxError>>;

// BalnSwapService — STILL THROW (tech debt; not Result-wrapped):
sodax.migration.balnSwapService.claim(...): Promise<TxReturnType<K, false>>;
sodax.migration.balnSwapService.claimUnstaked(...): Promise<TxReturnType<K, false>>;
sodax.migration.balnSwapService.stake(...): Promise<TxReturnType<K, false>>;
sodax.migration.balnSwapService.unstake(...): Promise<TxReturnType<K, false>>;
sodax.migration.balnSwapService.cancelUnstake(...): Promise<TxReturnType<K, false>>;
sodax.migration.balnSwapService.getDetailedUserLocks(...): Promise<DetailedUserLocks>;
```

## Action params shape

```ts
type MigrationParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  amount: bigint;
  dstAddress?: string;
};

type UnifiedBnUSDMigrateParams<K> = MigrationParams<K> & {
  srcToken: `0x${string}`;       // legacy or new bnUSD; SDK detects direction from address
  dstToken: `0x${string}`;       // the other side
};

type IcxToSodaMigrateParams<K> = MigrationParams<K>;
type RevertSodaToIcxParams<K> = MigrationParams<K>;
type BalnSwapParams<K> = MigrationParams<K> & {
  lockPeriodMonths: 0 | 1 | 2 | 3 | 6 | 12 | 18 | 24;  // reward multiplier 0.5x – 1.5x
};
```

## Common call shapes

### bnUSD migrate (forward — legacy → new, e.g. ICON → BASE)

```ts
const result = await sodax.migration.migratebnUSD({
  params: {
    srcChainKey: ChainKeys.ICON_MAINNET,
    srcAddress: 'hx…',
    srcToken: '0x…',  // legacy bnUSD on ICON
    dstToken: '0x…',  // new bnUSD on BASE
    amount: parseUnits('100', 18),
    dstAddress: '0x…',
  },
  raw: false,
  walletProvider: iconWp,
});

if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;
```

The SDK auto-detects direction from `(srcToken, dstToken)` addresses; the `direction` field surfaces on `error.context` if it fails (`'forward' | 'reverse'`).

### ICX → SODA

```ts
await sodax.migration.migrateIcxToSoda({
  params: { srcChainKey: ChainKeys.ICON_MAINNET, srcAddress: 'hx…', amount },
  raw: false,
  walletProvider: iconWp,
});
```

### Revert SODA → ICX

```ts
await sodax.migration.revertMigrateSodaToIcx({
  params: { srcChainKey: ChainKeys.SONIC_MAINNET, srcAddress: '0x…', amount },
  raw: false,
  walletProvider: sonicWp,
});
```

### BALN → SODA with lockup

```ts
await sodax.migration.migrateBaln({
  params: {
    srcChainKey: ChainKeys.ICON_MAINNET,
    srcAddress: 'hx…',
    amount: parseUnits('1000', 18),
    lockPeriodMonths: 12,    // 1.0x base; 24 is 1.5x; 0 is 0.5x
  },
  raw: false,
  walletProvider: iconWp,
});
```

### Approve / allowance — action-discriminated

```ts
await sodax.migration.approve({
  params: { srcChainKey, srcAddress, amount, action: 'migratebnUSD' /* or 'migrateIcxToSoda' | 'revertMigrateSodaToIcx' | 'migrateBaln' */ },
  raw: false,
  walletProvider,
});
```

### BALN lock management (carve-out — still throws)

```ts
try {
  const tx = await sodax.migration.balnSwapService.stake({ /* … */ });
} catch (e) {
  // Handle as v1-style throw. Result wrapping for these methods is on the roadmap.
}
```

## Return shapes

| Method | Success type |
|---|---|
| 4 orchestrators (`migratebnUSD`, `migrateIcxToSoda`, `revertMigrateSodaToIcx`, `migrateBaln`) | `TxHashPair` |
| 4 intent creators | `CreateIntentResult<K, Raw>` |
| `approve` | `TxReturnType<K, Raw>` |
| `isAllowanceValid` | `boolean` |
| `getAvailableAmount` | `bigint` |
| `BalnSwapService.claim` etc. | `TxReturnType<K, false>` (raw, not `Result`-wrapped) |

## Error codes

`feature: 'migration'`. Per-method narrow unions:

| Method | Codes | `error.context.action` | Notes |
|---|---|---|---|
| `migratebnUSD` | full exec set incl. `TX_VERIFICATION_FAILED` | `'migratebnUSD'` | `error.context.direction: 'forward' \| 'reverse'`. Has secondary `phase: 'destinationExecution'` for the bnUSD `waitUntilIntentExecuted` watcher. |
| `migrateIcxToSoda` | full exec set | `'migrateIcxToSoda'` | |
| `revertMigrateSodaToIcx` | full exec set | `'revertMigrateSodaToIcx'` | |
| `migrateBaln` | full exec set | `'migrateBaln'` | |
| `create*Intent` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` | matches | |
| `approve` | `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` | matches | |
| `isAllowanceValid` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` | n/a | |
| `getAvailableAmount` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` | n/a | `method: 'getAvailableAmount'` |

## Cross-references

- v1 → v2 migration of this feature: [`../../migration/features/icx-bnusd-baln.md`](../../migration/features/icx-bnusd-baln.md).
- Architecture (relay layer's `phase: 'destinationExecution'` for bnUSD): [`../architecture.md`](../architecture.md) § 9.
