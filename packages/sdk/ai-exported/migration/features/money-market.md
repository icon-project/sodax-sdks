# Money Market migration — v1 → v2

Pure-SDK migration playbook for `MoneyMarketService`.

Pair: [`../../integration/features/money-market.md`](../../integration/features/money-market.md).

## TL;DR

1. **Drop `spokeProvider` from every params object.** Pass `walletProvider` directly into the SDK call payload alongside `params` and `raw: false`.
2. **Add `srcChainKey` + `srcAddress` to every action params object.** v2's `MoneyMarketParams<K>` requires both; v1 didn't have them at all.
3. **Mutations resolve `Result<TxHashPair>`, not throw.** v1 mutation methods threw; v2 returns `{ ok: false, error }` on SDK-level failure. Branch on `result.ok`.
4. **`MoneyMarketSupplyParams` etc. are now generic** (`MoneyMarketSupplyParams<K extends SpokeChainKey>`). Add a chain-key generic to your params variables, or let TS infer from a literal `srcChainKey`.
5. **Replace `moneyMarketSupportedTokens[chainId]` with `sodax.moneyMarket.getSupportedTokensByChainId(chainKey)`.**
6. **Replace `hubAssets[chainId][address]?.vault` with `token.vault`** (now baked into `XToken`). Same for `token.hubAsset`.
7. **`useAToken` returns `Erc20Token & { chainKey }`, not a full `XToken`.** No `hubAsset` / `vault` on the result. Look up the full `XToken` separately via `sodax.config.getMoneyMarketToken(chainKey, address)` if needed.
8. **Errors → `SodaxError` + `Result<T>`.** v1's `MoneyMarketError<MoneyMarketErrorCode>` is gone. The CODE moved from `error.code` to `error.message`-style? **No** — it's still on `error.code`, but the union changed (see crosswalk below).

## Type / symbol cheat sheet

### Field-level renames

| Type | v1 shape | v2 shape | Notes |
|---|---|---|---|
| `MoneyMarketSupplyParams` | `{ token, amount, action }` | `{ srcChainKey, srcAddress, token, amount, action, dstChainKey?, dstAddress? }` | Same template for borrow / withdraw / repay. Now generic in `K extends SpokeChainKey`. |
| `MoneyMarketBorrowParams` | non-generic | `MoneyMarketBorrowParams<K>` | Optional `dstChainKey`/`dstAddress` for cross-chain delivery. |
| `MoneyMarketRepayParams` | non-generic | `MoneyMarketRepayParams<K>` | Optional `dstChainKey`/`dstAddress` for paying off debt on a different chain. |
| `XToken` | `xChainId` | `chainKey` | Type renamed `Token` → `XToken`. New fields `vault`, `hubAsset` baked in. |

### Deleted symbols

- `moneyMarketSupportedTokens` — `Record<SpokeChainKey, XToken[]>` global. Use `sodax.moneyMarket.getSupportedTokensByChainId(chainKey)` / `getSupportedTokens()`.
- `hubAssets` — vault address lookup global. Use `XToken.vault` / `XToken.hubAsset` directly.
- `SodaTokens` — vault-validation registry. Use `sodax.config.getMoneyMarketReserveAssets()`.
- `MoneyMarketError<MoneyMarketErrorCode>` and `isMoneyMarketError` — replaced by `SodaxError<C>` + `isSodaxError(e) && e.feature === 'moneyMarket'`.
- `useSpokeProvider` (React) — gone. Pass `walletProvider` directly.

### v1 → v2 error code crosswalk (money-market-specific)

| v1 `MoneyMarketErrorCode` | v2 code + context |
|---|---|
| `CREATE_SUPPLY_INTENT_FAILED` | `INTENT_CREATION_FAILED` (`action: 'supply'`) |
| `CREATE_BORROW_INTENT_FAILED` | `INTENT_CREATION_FAILED` (`action: 'borrow'`) |
| `CREATE_WITHDRAW_INTENT_FAILED` | `INTENT_CREATION_FAILED` (`action: 'withdraw'`) |
| `CREATE_REPAY_INTENT_FAILED` | `INTENT_CREATION_FAILED` (`action: 'repay'`) |
| `SUPPLY_FAILED` | `EXECUTION_FAILED` (`action: 'supply'`) |
| `BORROW_FAILED` | `EXECUTION_FAILED` (`action: 'borrow'`) |
| `WITHDRAW_FAILED` | `EXECUTION_FAILED` (`action: 'withdraw'`) |
| `REPAY_FAILED` | `EXECUTION_FAILED` (`action: 'repay'`) |
| `ALLOWANCE_CHECK_FAILED` | `ALLOWANCE_CHECK_FAILED` (unchanged) |
| `APPROVE_FAILED` | `APPROVE_FAILED` (unchanged) |
| `GAS_ESTIMATION_FAILED` | `GAS_ESTIMATION_FAILED` (unchanged) |

## Per-method delta

### `supply`

```diff
- const params: MoneyMarketSupplyParams = {
-   token: token.address,
-   amount: parseUnits('100', 6),
-   action: 'supply',
- };
- const result = await sodax.moneyMarket.supply({ params, spokeProvider });
- // result throws on failure, or returns the tx hash
+ const params: MoneyMarketSupplyParams<typeof srcChainKey> = {
+   srcChainKey: ChainKeys.ARBITRUM_MAINNET,
+   srcAddress: '0x…',
+   token: token.address,
+   amount: parseUnits('100', 6),
+   action: 'supply',
+ };
+ const result = await sodax.moneyMarket.supply({ params, raw: false, walletProvider });
+ if (!result.ok) {
+   // result.error: SodaxError with feature: 'moneyMarket'
+   return;
+ }
+ const { srcChainTxHash, dstChainTxHash } = result.value;
```

### `borrow` — gain cross-chain delivery

If you ported a same-chain borrow, no new fields needed — just `srcChainKey` + `srcAddress`. For cross-chain delivery (which v1 didn't expose this cleanly), add `dstChainKey` and `dstAddress`:

```ts
await sodax.moneyMarket.borrow({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress,
    token: USDC.address,
    amount,
    action: 'borrow',
    dstChainKey: ChainKeys.STELLAR_MAINNET,    // NEW in v2
    dstAddress: 'G…',                           // NEW in v2
  },
  raw: false,
  walletProvider,
});
```

### `repay` — pay from a different chain than the debt

Similar: v2 lets the spender chain (`srcChainKey`) differ from the debt chain (`dstChainKey`):

```ts
await sodax.moneyMarket.repay({
  params: {
    srcChainKey: fromChain,
    srcAddress: fromAddress,
    token: tokenOnFromChain.address,
    amount,
    action: 'repay',
    dstChainKey: debtChain,
    dstAddress: debtAddress,
  },
  raw: false,
  walletProvider: walletOnFromChain,
});
```

### `approve` / `isAllowanceValid`

```diff
- const allowed = await sodax.moneyMarket.isAllowanceValid({ params, spokeProvider });
+ const allowed = await sodax.moneyMarket.isAllowanceValid({
+   params,           // includes srcChainKey, srcAddress, action
+   raw: true,        // read-only — walletProvider not needed
+ });
+ if (!allowed.ok) return false;
+ if (!allowed.value) await sodax.moneyMarket.approve({ params, raw: false, walletProvider });
```

The `params.action` field discriminates which token gets approved (relevant for repay where the spent token may differ).

## Replacing the static lookups

```diff
- import { moneyMarketSupportedTokens, hubAssets } from '@sodax/types';
- const supplyTokens = moneyMarketSupportedTokens[chainId];
+ const supplyTokens = sodax.moneyMarket.getSupportedTokensByChainId(chainKey);

- const allTokens = Object.entries(moneyMarketSupportedTokens)
-   .flatMap(([chainId, tokens]) => tokens.map(t => ({ ...t, xChainId: chainId })));
+ const allTokens = Object.entries(sodax.moneyMarket.getSupportedTokens())
+   .flatMap(([_chainKey, tokens]) => tokens);   // tokens already carry chainKey in v2
```

```diff
- const vault = hubAssets[chainId]?.[token.address]?.vault;
+ const vault = token.vault;   // baked into XToken
```

## Worked example — `SupplyModal` flow

```diff
  const sourceWalletProvider = useWalletProvider({ xChainId: selectedChainId });
- const sourceSpokeProvider = useSpokeProvider(selectedChainId, sourceWalletProvider);
- const { mutateAsync: supply } = useSupply(sourceSpokeProvider);
+ // dapp-kit hook is zero-arg in v2:
+ const { mutateAsync: supply } = useSupply();

  const params: MoneyMarketSupplyParams = useMemo(() => ({
+   srcChainKey: selectedChainId,
+   srcAddress: address,
    token: token.address,
    amount: parseUnits(amount, token.decimals),
    action: 'supply',
- }), [token.address, token.decimals, amount]);
+ }), [token.address, token.decimals, amount, address, selectedChainId]);

- const result = await supply({ params, spokeProvider: sourceSpokeProvider });
+ const txPair = await supply({ params, walletProvider: sourceWalletProvider });
+ const { srcChainTxHash, dstChainTxHash } = txPair;

  const successData: ActionSuccessData = {
    /* … */
-   destinationChainId: token.xChainId,
+   destinationChainId: token.chainKey,
    txHash: extractTxHash(result),
  };
```

## Pitfalls

1. **Forgetting `srcChainKey` + `srcAddress` in params.** TypeScript surfaces this as `error TS1360: Type '{ token, amount, action }' does not satisfy the expected type 'MoneyMarketSupplyParams'`. Add both required fields.
2. **Borrow/repay default delivery to source.** Omit `dstChainKey`/`dstAddress` if you want same-chain. Don't pass them as the same value as `srcChainKey` / `srcAddress` — let the default kick in.
3. **`useAToken` returns a partial token.** `Erc20Token & { chainKey }`, not a full `XToken`. No `vault` / `hubAsset`. Look up the full `XToken` via `sodax.config.getMoneyMarketToken(chainKey, address)` separately if you need those fields.
4. **`hubAssets` is gone.** Anything that walked it for vault lookup must use `token.vault` directly.
5. **`baseChainInfo[chain].id` is gone — entries have `.key`.** Common in `ChainSelector`-style components.
6. **`spokeProvider.chainConfig.chain.type === 'EVM'`** is gone. Use `getChainType(chainKey) === 'EVM'` from `@sodax/sdk`.
7. **`Number(chainKey)` returns `NaN` for non-numeric keys.** `ChainKeys.ICON_MAINNET` is `'0x1.icon'`; numeric coercions break.

## Verification

```bash
pnpm -C <your-app-dir> checkTs

# Targeted scans:
grep -rE "spokeProvider:\s*\w+|moneyMarketSupportedTokens|\bhubAssets\b" src/
grep -rE "isMoneyMarketError\b|MoneyMarketError\b" src/
```

## Cross-references

- v2 money market usage: [`../../integration/features/money-market.md`](../../integration/features/money-market.md).
- Cross-cutting prerequisites listed in [`../README.md`](../README.md).
