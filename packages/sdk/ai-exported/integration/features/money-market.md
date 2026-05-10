# Money Market — `MoneyMarketService`

Cross-chain lending and borrowing. Supply, borrow, withdraw, repay across 19 spoke chains. Position state lives on the hub.

Access: `sodax.moneyMarket`. Service class: `MoneyMarketService`. Feature tag for errors: `'moneyMarket'`.

## How it works

A user supplies on a spoke chain; the SDK relays the deposit to the hub, where the position is recorded against the user's hub wallet abstraction. Borrow can deliver funds back to the same chain (same-chain borrow) or to a different spoke chain (cross-chain borrow). Withdraw and repay reverse the flow.

aTokens (ERC4626 receipt tokens) live on the hub and represent the user's share of each reserve. Use `sodax.moneyMarket.getAToken(...)` to look them up.

## Public methods

```ts
// Mutations
sodax.moneyMarket.supply<K>(action): Promise<Result<TxHashPair, SodaxError>>;
sodax.moneyMarket.borrow<K>(action): Promise<Result<TxHashPair, SodaxError>>;
sodax.moneyMarket.withdraw<K>(action): Promise<Result<TxHashPair, SodaxError>>;
sodax.moneyMarket.repay<K>(action): Promise<Result<TxHashPair, SodaxError>>;

// Intent creators (raw-tx variant)
sodax.moneyMarket.createSupplyIntent<K, Raw>(...): Promise<Result<...>>;
sodax.moneyMarket.createBorrowIntent<K, Raw>(...): Promise<Result<...>>;
sodax.moneyMarket.createWithdrawIntent<K, Raw>(...): Promise<Result<...>>;
sodax.moneyMarket.createRepayIntent<K, Raw>(...): Promise<Result<...>>;

// Approve + allowance (action-discriminated)
sodax.moneyMarket.approve<K, Raw>(args): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;
sodax.moneyMarket.isAllowanceValid<K>(args): Promise<Result<boolean, SodaxError>>;

// Estimation
sodax.moneyMarket.estimateGas<K>(params): Promise<Result<GetEstimateGasReturnType<K>, SodaxError>>;

// Reads (sync — config-derived, no I/O)
sodax.moneyMarket.getSupportedTokens(): GetMoneyMarketTokensApiResponse;
sodax.moneyMarket.getSupportedTokensByChainId(chainKey): readonly XToken[];
sodax.moneyMarket.getSupportedReserves(): readonly Address[];

// Hub-side calldata builders (Hex outputs; pre-flight inspection / custom orchestration)
sodax.moneyMarket.buildSupplyData(srcChainKey, fromToken, amount, toHubAddress): Hex;
sodax.moneyMarket.buildBorrowData(...): Hex;
sodax.moneyMarket.buildWithdrawData(...): Hex;
sodax.moneyMarket.buildRepayData(...): Hex;
```

For per-position user reads (reserves data, user reserves data, formatted summaries, aToken balances, etc.) the entrypoint is `sodax.backendApi`, not `MoneyMarketService` — see `auxiliary-services.md` § "BackendApiService" for `getMoneyMarketPosition`, `getAllMoneyMarketAssets`, `getMoneyMarketAsset`, `getMoneyMarketAssetBorrowers`, `getMoneyMarketAssetSuppliers`, `getAllMoneyMarketBorrowers`.

## Action params shape

`MoneyMarketParams<K>` is the shared base:

```ts
type MoneyMarketParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  token: `0x${string}`;     // hub asset address
  amount: bigint;
};
```

Per-action params:

```ts
type MoneyMarketSupplyParams<K> = MoneyMarketParams<K> & { action: 'supply' };
type MoneyMarketWithdrawParams<K> = MoneyMarketParams<K> & { action: 'withdraw' };

type MoneyMarketBorrowParams<K> = MoneyMarketParams<K> & {
  action: 'borrow';
  dstChainKey?: SpokeChainKey;   // delivery chain; defaults to srcChainKey
  dstAddress?: string;
};
type MoneyMarketRepayParams<K> = MoneyMarketParams<K> & {
  action: 'repay';
  dstChainKey?: SpokeChainKey;   // debt chain; defaults to srcChainKey
  dstAddress?: string;
};
```

## Common call shapes

### Supply (same-chain)

```ts
const result = await sodax.moneyMarket.supply({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: '0x…',
    token: USDC.address,
    amount: parseUnits('100', 6),
    action: 'supply',
  },
  raw: false,
  walletProvider: evmWp,
});

if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;
```

### Borrow (cross-chain)

Borrow on Arbitrum, deliver USDC to Stellar:

```ts
await sodax.moneyMarket.borrow({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: '0x…',
    token: USDC_ARBITRUM.address,
    amount: parseUnits('50', 6),
    action: 'borrow',
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    dstAddress: 'G…',
  },
  raw: false,
  walletProvider: evmWp,
});
```

Same-chain borrow: omit `dstChainKey` and `dstAddress`.

### Repay (cross-chain — pay from a different chain than the debt)

```ts
await sodax.moneyMarket.repay({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,            // funds come from here
    srcAddress: '0x…',
    token: USDC_BASE.address,
    amount: parseUnits('50', 6),
    action: 'repay',
    dstChainKey: ChainKeys.ARBITRUM_MAINNET,        // debt lives here
    dstAddress: '0x…',
  },
  raw: false,
  walletProvider: baseWp,    // wallet signs on the FROM chain (BASE)
});
```

### Approve / allowance check

```ts
await sodax.moneyMarket.approve({
  params: { srcChainKey, srcAddress, token, amount, action: 'supply' },
  raw: false,
  walletProvider: evmWp,
});

const allowed = await sodax.moneyMarket.isAllowanceValid({
  params: { srcChainKey, srcAddress, token, amount, action: 'supply' },
});
```

The `action` field routes to the right token under the hood — relevant for repay where the spent token may differ from the supplied token.

## Return shapes

| Method | Success type |
|---|---|
| `supply`, `borrow`, `withdraw`, `repay` | `TxHashPair` = `{ srcChainTxHash, dstChainTxHash }` |
| `create*Intent` | `CreateIntentResult<K, Raw>` |
| `approve` | `TxReturnType<K, Raw>` |
| `isAllowanceValid` | `boolean` |
| `estimateGas` | `GetEstimateGasReturnType<K>` (chain-family-specific) |
| `getSupportedTokens` | `GetMoneyMarketTokensApiResponse` (record of chains → token arrays) |
| `getSupportedTokensByChainId` | `readonly XToken[]` |
| `getSupportedReserves` | `readonly Address[]` |
| `buildSupplyData` / `buildBorrowData` / `buildWithdrawData` / `buildRepayData` | `Hex` (calldata for hub-side calls) |

> Every cross-chain mutation across the SDK (bridge, staking, dex, migration, MM) returns `TxHashPair = { srcChainTxHash, dstChainTxHash }` — there is no array-form variant in v2.

## Error codes

`feature: 'moneyMarket'`. Per-method narrow unions:

| Method | Codes | `error.context.action` |
|---|---|---|
| `supply` | full exec set | `'supply'` |
| `borrow` | full exec set | `'borrow'` |
| `withdraw` | full exec set | `'withdraw'` |
| `repay` | full exec set | `'repay'` |
| `create*Intent` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` | matches action |
| `approve` | `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` | matches action |
| `isAllowanceValid` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` | matches action |
| Read methods | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` | (use `error.context.method`) |

"Full exec set" = `VALIDATION_FAILED \| INTENT_CREATION_FAILED \| EXECUTION_FAILED \| TX_VERIFICATION_FAILED \| TX_SUBMIT_FAILED \| RELAY_TIMEOUT \| RELAY_FAILED \| UNKNOWN`.

## RAY precision math

Aave's RAY precision (27 decimals) is used for interest calculations under the hood. Raw RAY values flow through `BackendApiService.getMoneyMarketAsset` / `getMoneyMarketPosition` (via `sodax.backendApi`); pre-formatted user-facing values come from the same backend service. Don't simplify the precision handling — porting Aave's `RayMath`/`PercentageMath` losslessly is a load-bearing requirement.

## Cross-references

- v1 → v2 money market migration: [`../../migration/features/money-market.md`](../../migration/features/money-market.md).
- Architecture (hub-side wallet abstraction, ConfigService): [`../architecture.md`](../architecture.md) §§ 3, 4.
- Stellar destinations need a trustline: [`../chain-specifics.md`](../chain-specifics.md).
