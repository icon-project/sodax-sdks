---
name: sodax-sdk-backend-api
description: 'Granular skill for the @sodax/sdk v2 BackendApiService — HTTP client to the SODAX backend for intent lookup, swap-tx submission, solver orderbook, money-market position/reserve reads, and (internally) config fetching. Use when the task touches a backend read or write (e.g. "submit swap tx to Sodax backend", "Sodax getIntentByHash", "fetch money market position from Sodax backend", "Sodax orderbook", "Sodax BackendApiService", "implement custom IConfigApi sandbox"). Covers BOTH integration and the load-bearing v1 → v2 Result-wrapping migration. Skill links into the parent sodax-sdk knowledge tree.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Backend API (Core SDK granular skill)

Granular skill for `BackendApiService` — `sodax.backendApi`. HTTP client used by every feature for reads + swap-tx submission. **Feature tag for errors** varies by call site (e.g. `'swap'` for `submitSwapTx`, `'moneyMarket'` for MM reads); errors always carry `error.context.api: 'backend'`.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** Note: v2's load-bearing change is `Result`-wrapping every method (v1 threw on failure).
2. **Which category?**
   - **Swap-related reads / writes:** `submitSwapTx`, `getSubmitSwapTxStatus`, `getOrderbook`, `getIntentByHash`, `getIntentByTxHash`, `getUserIntents`.
   - **Money-market position reads:** `getMoneyMarketPosition`, `getAllMoneyMarketAssets`, `getMoneyMarketAsset`, `getMoneyMarketAssetBorrowers`, `getMoneyMarketAssetSuppliers`, `getAllMoneyMarketBorrowers`.
   - **Config-API methods (implements `IConfigApi`):** `getAllConfig`, `getChains`, `getSwapTokens`, `getSwapTokensByChainId`, `getMoneyMarketTokens`, `getMoneyMarketReserveAssets`, `getMoneyMarketTokensByChainId`, `getRelayChainIdMap`.
3. **Custom `IConfigApi` for sandbox / fixtures?** Every method must return `Promise<Result<T>>` in v2.

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md).
2. [`../integration/knowledge/features/backend-api.md`](../integration/knowledge/features/backend-api.md) — `BackendApiService` API + `submitSwapTx` call shape + custom-backend pattern.
3. For the `submitSwapTx` + `createIntent` flow → also load [`../swap/SKILL.md`](../swap/SKILL.md) or read [`../integration/knowledge/features/swap.md`](../integration/knowledge/features/swap.md) § "Backend submit-tx flow".
4. Errors carry `error.context.api === 'backend'` → [`../integration/knowledge/recipes/result-and-errors.md`](../integration/knowledge/recipes/result-and-errors.md) and [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### Backend-API-specific anti-patterns

- **Passing the `RelayExtraData` object** to `submitSwapTx.relayData`. The field is now `string` — pass `relayData.payload`.
- **Using v1 `srcChainId` (numeric)** on `SubmitSwapTxRequest`. Renamed to `srcChainKey: SpokeChainKey`.
- **Implementing `IConfigApi` with throw-on-error semantics.** v2 interface requires `Promise<Result<T>>` — every method.
- **Reading money-market position from `MoneyMarketService`.** Those reads live here on `BackendApiService`.

## Migration workflow (v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md).
2. [`../migration-v1-to-v2/knowledge/features/backend-api.md`](../migration-v1-to-v2/knowledge/features/backend-api.md) — the load-bearing change: every method now returns `Promise<Result<T>>`. Includes the `submitSwapTx` request-shape changes (`srcChainId` → `srcChainKey`, `relayData` object → string) and the `IConfigApi` sandbox-impl change.
3. Cross-cutting `IConfigApi` Result-wrapping note → [`../migration-v1-to-v2/knowledge/breaking-changes/type-system.md`](../migration-v1-to-v2/knowledge/breaking-changes/type-system.md) § 6.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.backendApi.<method>(...)` has `if (!result.ok)`.
3. `SubmitSwapTxRequest` uses `srcChainKey` (not `srcChainId`) and `relayData: relayData.payload` (string).
4. Any custom `IConfigApi` implementation returns `Promise<Result<T>>` from every method.

## Related granular skills (same family)

- [`../swap/SKILL.md`](../swap/SKILL.md) — `submitSwapTx` is the backend half of the step-by-step swap flow.
- [`../money-market/SKILL.md`](../money-market/SKILL.md) — `BackendApiService` is the canonical source of MM position reads.
- [`../partner/SKILL.md`](../partner/SKILL.md), [`../recovery/SKILL.md`](../recovery/SKILL.md) — diagnostics for failures via intent / tx lookups.

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
