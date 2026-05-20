# Breaking changes — narrative

One file per change, with the WHY behind it. Use this folder to understand intent; use [`../reference/`](../reference/) for mechanical name lookups; use [`../recipes/`](../recipes/) for paired before/after code.

**Every v1→v2 change at the wallet-sdk-core public surface is additive.** v1 consumer code drops in unchanged.

| File | Change | Action required |
|---|---|---|
| [`folder-layout.md`](./folder-layout.md) | Source layout: `wallet-providers/*.ts` (v1, flat) → `wallet-providers/<chain>/*.ts` (v2, folder-per-chain). | Only if user deep-imported `src/...`. Replace with barrel imports. |
| [`base-wallet-provider.md`](./base-wallet-provider.md) | `BaseWalletProvider<TDefaults>` introduced as shared abstract base. | None — internal. |
| [`defaults-config.md`](./defaults-config.md) | Every provider accepts an optional `defaults` slice. | None. Optional cleanup: drop hand-rolled default-injection wrappers. |
| [`library-exports.md`](./library-exports.md) | Upstream chain types re-exported from `@sodax/wallet-sdk-core`. | None. Optional cleanup: drop direct upstream-SDK deps for type-only usage. |

None of these are breaking at the type level. **There are no renames, no removals, no required-field additions.** If you see a v1 `*WalletConfig` symbol that doesn't compile against v2, file an issue — it's a regression, not a documented breaking change.
