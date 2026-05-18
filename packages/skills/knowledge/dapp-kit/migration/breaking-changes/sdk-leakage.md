# SDK leakage — v1 → v2

Some v1 dapp-kit migration items are really *SDK* migrations that surface through dapp-kit's hook signatures. Each is documented in detail in the SDK's migration tree — this file summarizes what you'll see at the dapp-kit layer and links out for the full picture.

## chain-key terminology

The SDK renamed `xChainId` / `srcChainId` / `dstChainId` to `chainKey` / `srcChainKey` / `dstChainKey` on token shapes and request params. In dapp-kit, this surfaces in:

```diff
- // useGetBridgeableTokens — v1 took chain ids
- useGetBridgeableTokens(BASE_MAINNET_CHAIN_ID, POLYGON_MAINNET_CHAIN_ID, '0x...');
+ // v2 takes chain keys via the canonical query shape
+ useGetBridgeableTokens({ params: { from: ChainKeys.BASE_MAINNET, to: ChainKeys.POLYGON_MAINNET, token: '0x...' } });
```

```diff
- // bridge params — v1
- await bridge({ params: { srcChainId: BASE_MAINNET_CHAIN_ID, dstChainId: POLYGON_MAINNET_CHAIN_ID, /* ... */ } });
+ // v2
+ await bridge({ params: { srcChainKey: ChainKeys.BASE_MAINNET, dstChainKey: ChainKeys.POLYGON_MAINNET, /* ... */ }, walletProvider });
```

```diff
- // XToken read shape — v1
- const chainId = token.xChainId;
+ // v2
+ const chainKey = token.chainKey;
```

**Note:** `useXBalances` request params still take `xChainId` (the field name stayed for the cross-chain abstraction it overlays). This is distinct from the renamed token-side `chainKey`. Don't conflate them.

**Note:** `Intent.srcChain` / `Intent.dstChain` (read shape) kept their names. They're `IntentRelayChainId` (bigints), distinct from request-side `srcChainKey` / `dstChainKey`. Don't blanket grep-replace.

Full SDK-level detail: [`../../../sdk/migration/breaking-changes/type-system.md`](../../../sdk/migration/breaking-changes/type-system.md).

## Required `srcChainKey` + `srcAddress` on action params

v1 mutation params were minimal (`{ token, amount, action }`). v2 added required `srcChainKey` + `srcAddress` to every feature's action params. The chain key drives spoke routing internally; the address is the user's spoke-side address.

```diff
- // v1
- await supply({ params: { token, amount, action: 'supply' } });
+ // v2
+ await supply({
+   params: {
+     srcChainKey: ChainKeys.BASE_MAINNET,
+     srcAddress: '0x...',                  // NEW: required
+     token,
+     amount,
+     action: 'supply',
+   },
+   walletProvider,
+ });
```

Same applies to `useBorrow`, `useWithdraw`, `useRepay`, `useStake`, `useUnstake`, `useBridge`, `useDexDeposit`, `useDexWithdraw`, etc. — anywhere the SDK now requires it.

Full SDK-level detail: [`../../../sdk/migration/features/`](../../../sdk/migration/features/) — each feature's migration file lists the required new fields.

## `*_MAINNET_CHAIN_ID` constants gone

v1 exported individual constants (`BSC_MAINNET_CHAIN_ID`, `BASE_MAINNET_CHAIN_ID`, etc.). v2 replaces them with the `ChainKeys.*` namespace.

```diff
- import { BSC_MAINNET_CHAIN_ID, BASE_MAINNET_CHAIN_ID } from '@sodax/sdk';
+ import { ChainKeys } from '@sodax/sdk';

- const chainKey = BSC_MAINNET_CHAIN_ID;
+ const chainKey = ChainKeys.BSC_MAINNET;
```

Codemod with sed:

```bash
find src -type f \( -name '*.ts' -o -name '*.tsx' \) | xargs sed -i '' -E 's/\b([A-Z_]+)_MAINNET_CHAIN_ID\b/ChainKeys.\1_MAINNET/g'
```

Then add `import { ChainKeys } from '@sodax/sdk'` (or `@sodax/dapp-kit`) where needed.

Full SDK-level detail: [`../../../sdk/migration/breaking-changes/type-system.md`](../../../sdk/migration/breaking-changes/type-system.md).

## `SodaxConfig` reshape — `rpcConfig` → `chains`

`SodaxProvider`'s config prop is `DeepPartial<SodaxConfig>`. The SDK renamed/restructured the config:

```diff
- <SodaxProvider rpcConfig={{
-   sonic: 'https://sonic-rpc.publicnode.com',
-   '0xa86a.avax': 'https://...',
- }}>
+ <SodaxProvider config={{
+   chains: {
+     [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://sonic-rpc.publicnode.com' },
+     [ChainKeys.AVALANCHE_MAINNET]: { rpcUrl: 'https://...' },
+   },
+ }}>
```

**Config is tracked by reference in v2.** See [`../../integration/recipes/setup.md § Config reactivity`](../../integration/recipes/setup.md#config-reactivity) for the module-const vs `useMemo` patterns. Drive runtime config switches (e.g. solver env) through `useMemo` deps, not by remounting the provider.

Other v1 fields renamed or restructured:

| v1 | v2 |
|---|---|
| `rpcConfig` | `chains[ChainKeys.X]: { rpcUrl }` |
| `backendApi: { url }` | `api: { baseURL }` |
| `swaps: { intentsContract, ... }` | Split: `solver: { intentsContract, ... }` for endpoints; `swaps: SwapsConfig` for supported tokens |
| `hubProviderConfig` | `hub: HubConfig` |

Full SDK-level detail: [`../../../sdk/migration/breaking-changes/architecture.md`](../../../sdk/migration/breaking-changes/architecture.md) (Appendix B).

## Error class

The SDK consolidated 7+ per-feature error classes (`MoneyMarketError<Code>`, `IntentError<Code>`, `StakingError<Code>`, `BridgeError<Code>`, `MigrationError<Code>`, etc.) into a single canonical `SodaxError<C>`.

If your dapp-kit consumer code catches errors from mutations and uses `instanceof XxxError`, those checks are now broken:

```diff
- // v1
- catch (e) {
-   if (e instanceof MoneyMarketError) {
-     console.error('MM-specific:', e.code);
-   }
- }

+ // v2
+ catch (e) {
+   if (isSodaxError(e) && e.feature === 'moneyMarket') {
+     console.error('MM-specific:', e.code);
+   }
+ }
```

`isSodaxError` is re-exported from `@sodax/dapp-kit`. Discriminate via `(error.feature, error.code)` — the feature is now a first-class field, and the code vocabulary is unified to 13 reason-only codes.

Full SDK-level detail: [`../../../sdk/migration/breaking-changes/result-and-errors.md`](../../../sdk/migration/breaking-changes/result-and-errors.md).

## `Result<T>` type and propagation

The SDK's `Result<T>` type is the same in v1 and v2. What changed is **where it's returned vs unwrapped**:

| | v1 | v2 |
|---|---|---|
| SDK service method return | `Result<T>` | `Result<T>` (unchanged) |
| dapp-kit `mutationFn` return | `Result<T>` | unwrapped `T` (throws on `!ok`) |
| Consumer's `mutation.data` | `Result<T>` | unwrapped `T` |

So at the SDK level, `Result<T>` semantics didn't change. But at the dapp-kit level, the unwrap point moved into the hook. See [`result-handling.md`](result-handling.md) for the full picture.

## Other SDK-level migrations

These are unlikely to leak through hook signatures unless your app reaches into the SDK directly via `useSodaxContext()`:

- **`*SpokeProvider` classes deleted** — the chain key drives spoke routing; no provider classes to construct. dapp-kit consumers never see these (you'd already be using `useSpokeProvider` which is gone).
- **`ConfigService` replaces static lookup tables** — `hubAssets`, `moneyMarketSupportedTokens`, `SodaTokens` globals are gone. Use `sodax.config.*` (which dapp-kit's hooks already do internally).
- **`WalletProviderSlot<K, Raw>` discriminated union** — a TypeScript-level construct; `walletProvider` is the typical consumer-facing shape.

For the full SDK migration playbook, start at [`../../../sdk/migration/README.md`](../../../sdk/migration/README.md).

## Cross-references

- [`../../../sdk/migration/README.md`](../../../sdk/migration/README.md) — full SDK migration overview.
- [`../../../sdk/migration/breaking-changes/type-system.md`](../../../sdk/migration/breaking-changes/type-system.md) — type renames + ChainKeys.
- [`../../../sdk/migration/breaking-changes/architecture.md`](../../../sdk/migration/breaking-changes/architecture.md) — `*SpokeProvider`, ConfigService, SodaxConfig reshape.
- [`../../../sdk/migration/breaking-changes/result-and-errors.md`](../../../sdk/migration/breaking-changes/result-and-errors.md) — `Result<T>` + error class consolidation.
- [`hook-signatures.md`](hook-signatures.md) — dapp-kit-only hook-shape changes.
- [`result-handling.md`](result-handling.md) — dapp-kit-only `Result<T>` unwrap-point shift.
