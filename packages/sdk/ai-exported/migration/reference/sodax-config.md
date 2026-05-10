# `SodaxConfig` constructor reshape

The v2 `Sodax` constructor accepts a `DeepPartial<SodaxConfig>`. Several config fields renamed or moved between v1 and v2; if your project passed a custom config, check these:

| v1 location | v2 location |
|---|---|
| `SodaxConfig.swaps` (held solver endpoints AND supported tokens) | Split into two: `SodaxConfig.swaps` (now `SwapsConfig` — supported tokens per chain) and `SodaxConfig.solver` (`{ intentsContract, solverApiEndpoint, protocolIntentsContract }`). |
| `SodaxConfig.rpcConfig` (flat object: one URL per chain field) | `SodaxConfig.rpcConfig` (mapped type keyed by `ChainKey` values; chain-family-specific shapes — see [`../breaking-changes/type-system.md`](../breaking-changes/type-system.md) § 5). |
| `SodaxConfig.hubProviderConfig` | Renamed: `SodaxConfig.hubConfig`. |
| `SodaxConfig.configService` (raw `IConfigApi` instance you injected) | Pass via `new Sodax({ configService: <your impl> })` is gone — `ConfigService` is constructed internally. To inject a custom `IConfigApi`, override via `SodaxConfig.backendApi`. |

Migration:

```diff
  const sodax = new Sodax({
-   swaps: {
-     intentsContract: '0x…',
-     solverApiEndpoint: 'https://…',
-     supportedTokens: { /* … */ },
-   },
+   solver: {
+     intentsContract: '0x…',
+     solverApiEndpoint: 'https://…',
+   },
+   swaps: {
+     supportedTokens: { /* per-chain table */ },
+   },
-   rpcConfig: { sonic: 'https://…', arbitrum: 'https://…' },
+   rpcConfig: {
+     [ChainKeys.SONIC_MAINNET]: 'https://…',
+     [ChainKeys.ARBITRUM_MAINNET]: 'https://…',
+     [ChainKeys.BITCOIN_MAINNET]: { /* BitcoinRpcConfig shape */ },
+     // …
+   },
-   hubProviderConfig: { /* … */ },
+   hubConfig: { /* … */ },
  });
  await sodax.config.initialize();
```

### Pitfall

If you previously injected a custom `ConfigService` for testing (a v1 escape hatch), v2 doesn't accept one at the top level. Inject a custom `IConfigApi` via `SodaxConfig.backendApi.api` instead — `ConfigService` consumes it internally on `initialize()`.

---


## Cross-references

- [`README.md`](README.md) — migration reference index.
- [`../README.md`](../README.md) — migration overview.
- [`../checklist.md`](../checklist.md) — top-level migration checklist.
