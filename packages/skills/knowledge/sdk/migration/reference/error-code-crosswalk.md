# v1 ↔ v2 code crosswalk

The widest-impact migration table in this file. v1 had per-module `*ErrorCode` unions; v2 reuses the 13 unified codes plus `feature` discrimination. **Match by intent, not by name** — the v1 `CREATE_SUPPLY_INTENT_FAILED` code is now `INTENT_CREATION_FAILED` with `feature: 'moneyMarket'` and `context.action: 'supply'`.

### Money Market (`MoneyMarketErrorCode` → `feature: 'moneyMarket'`)

| v1 code | v2 code | v2 context |
|---|---|---|
| `CREATE_SUPPLY_INTENT_FAILED` | `INTENT_CREATION_FAILED` | `action: 'supply'` |
| `CREATE_BORROW_INTENT_FAILED` | `INTENT_CREATION_FAILED` | `action: 'borrow'` |
| `CREATE_WITHDRAW_INTENT_FAILED` | `INTENT_CREATION_FAILED` | `action: 'withdraw'` |
| `CREATE_REPAY_INTENT_FAILED` | `INTENT_CREATION_FAILED` | `action: 'repay'` |
| `SUPPLY_FAILED` | `EXECUTION_FAILED` | `action: 'supply'` |
| `BORROW_FAILED` | `EXECUTION_FAILED` | `action: 'borrow'` |
| `WITHDRAW_FAILED` | `EXECUTION_FAILED` | `action: 'withdraw'` |
| `REPAY_FAILED` | `EXECUTION_FAILED` | `action: 'repay'` |
| `ALLOWANCE_CHECK_FAILED` | `ALLOWANCE_CHECK_FAILED` | (unchanged) |
| `APPROVE_FAILED` | `APPROVE_FAILED` | (unchanged) |
| `GAS_ESTIMATION_FAILED` | `GAS_ESTIMATION_FAILED` | (unchanged) |

### Swap (`IntentErrorCode` → `feature: 'swap'`)

| v1 code | v2 code | v2 context |
|---|---|---|
| `CREATE_INTENT_FAILED` | `INTENT_CREATION_FAILED` | `action: 'createIntent'` |
| `CREATE_LIMIT_ORDER_FAILED` | `INTENT_CREATION_FAILED` | `action: 'createLimitOrder'` |
| `POST_EXECUTION_FAILED` | `EXECUTION_FAILED` | `action: 'swap'`, `phase: 'postExecution'` |
| `SOLVER_API_ERROR` | `EXTERNAL_API_ERROR` | `api: 'solver'`, `solverCode`/`solverDetail` on context |
| `SIMULATION_FAILED` | `EXECUTION_FAILED` | `phase: 'execution'` |

### Staking (`StakingErrorCode` → `feature: 'staking'`)

| v1 code | v2 code | v2 context |
|---|---|---|
| `STAKE_FAILED` | `EXECUTION_FAILED` | `action: 'stake'` |
| `UNSTAKE_FAILED` | `EXECUTION_FAILED` | `action: 'unstake'` |
| `INSTANT_UNSTAKE_FAILED` | `EXECUTION_FAILED` | `action: 'instantUnstake'` |
| `CLAIM_FAILED` | `EXECUTION_FAILED` | `action: 'claim'` |
| `CANCEL_UNSTAKE_FAILED` | `EXECUTION_FAILED` | `action: 'cancelUnstake'` |
| `GET_STAKING_INFO_FAILED` | `LOOKUP_FAILED` | `method: 'getStakingInfo'` |
| `GET_UNSTAKING_INFO_FAILED` | `LOOKUP_FAILED` | `method: 'getUnstakingInfo'` |
| `GET_STAKING_CONFIG_FAILED` | `LOOKUP_FAILED` | `method: 'getStakingConfig'` |
| `GET_STAKE_RATIO_FAILED` | `LOOKUP_FAILED` | `method: 'getStakeRatio'` |

### Bridge (`BridgeErrorCode` → `feature: 'bridge'`)

| v1 code | v2 code | v2 context |
|---|---|---|
| `BRIDGE_FAILED` | `EXECUTION_FAILED` | `action: 'bridge'` |
| `CREATE_BRIDGE_INTENT_FAILED` | `INTENT_CREATION_FAILED` | `action: 'bridge'` |
| `GET_BRIDGEABLE_AMOUNT_FAILED` | `LOOKUP_FAILED` | `method: 'getBridgeableAmount'` |
| `GET_BRIDGEABLE_TOKENS_FAILED` | `LOOKUP_FAILED` | `method: 'getBridgeableTokens'` |

### Migration (`MigrationErrorCode` → `feature: 'migration'`)

| v1 code | v2 code | v2 context |
|---|---|---|
| `MIGRATE_BNUSD_FORWARD_FAILED` | `EXECUTION_FAILED` | `action: 'migratebnUSD'`, `direction: 'forward'` |
| `MIGRATE_BNUSD_REVERSE_FAILED` | `EXECUTION_FAILED` | `action: 'migratebnUSD'`, `direction: 'reverse'` |
| `MIGRATE_ICX_TO_SODA_FAILED` | `EXECUTION_FAILED` | `action: 'migrateIcxToSoda'` |
| `REVERT_MIGRATE_SODA_TO_ICX_FAILED` | `EXECUTION_FAILED` | `action: 'revertMigrateSodaToIcx'` |
| `MIGRATE_BALN_FAILED` | `EXECUTION_FAILED` | `action: 'migrateBaln'` |
| `GET_AVAILABLE_AMOUNT_FAILED` | `LOOKUP_FAILED` | `method: 'getAvailableAmount'` |

### DEX (`AssetServiceErrorCode` + `ConcentratedLiquidityErrorCode` → `feature: 'dex'`)

| v1 code | v2 code | v2 context |
|---|---|---|
| `DEPOSIT_FAILED` | `EXECUTION_FAILED` | `action: 'deposit'` |
| `WITHDRAW_FAILED` | `EXECUTION_FAILED` | `action: 'withdraw'` |
| `SUPPLY_LIQUIDITY_FAILED` | `EXECUTION_FAILED` | `action: 'supplyLiquidity'` |
| `INCREASE_LIQUIDITY_FAILED` | `EXECUTION_FAILED` | `action: 'increaseLiquidity'` |
| `DECREASE_LIQUIDITY_FAILED` | `EXECUTION_FAILED` | `action: 'decreaseLiquidity'` |
| `CLAIM_REWARDS_FAILED` | `EXECUTION_FAILED` | `action: 'claimRewards'` |
| `GET_POOL_DATA_FAILED` | `LOOKUP_FAILED` | `method: 'getPoolData'` |
| `GET_POSITION_INFO_FAILED` | `LOOKUP_FAILED` | `method: 'getPositionInfo'` |

### Relay (`RelayErrorCode` → typically still on `context.relayCode`)

The relay-layer code strings are kept on `context.relayCode` of the surfaced `SodaxError`. They are also a stable public contract used by lower-level relay code:

| v1 code | v2 code on `error.code` | v2 `context.relayCode` |
|---|---|---|
| `SUBMIT_TX_FAILED` | `TX_SUBMIT_FAILED` | `'SUBMIT_TX_FAILED'` |
| `RELAY_TIMEOUT` | `RELAY_TIMEOUT` | `'RELAY_TIMEOUT'` |
| `RELAY_POLLING_FAILED` | `RELAY_FAILED` | `'RELAY_POLLING_FAILED'` |
| (any unrecognised) | `RELAY_FAILED` | `'UNKNOWN'` |

### Partner (5 typed errors → `feature: 'partner'`)

All partner typed errors collapse to `EXECUTION_FAILED` with `action` discriminating between the 5 v1 operations.

### Recovery (no v1 typed errors — module is v2-new) → `feature: 'recovery'`

`EXECUTION_FAILED` for the recovery action; `LOOKUP_FAILED` for read methods.

---


## Cross-references

- [`README.md`](README.md) — migration reference index.
- [`../README.md`](../README.md) — migration overview.
- [`../checklist.md`](../checklist.md) — top-level migration checklist.
