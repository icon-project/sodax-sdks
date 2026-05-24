# Migration recipes

Paired before/after for each migration task. Apply only what the user's project triggers.

**There are no mandatory migration recipes for wallet-sdk-core.** v1 consumer code drops in unchanged.

| Recipe | When to apply | Mandatory? |
|---|---|---|
| [`adopt-defaults.md`](./adopt-defaults.md) | User has hand-rolled wrappers (`makeProvider`, `buildProvider`, `withDefaults`) that injected default options. | No — additive cleanup. |
| [`adopt-library-exports.md`](./adopt-library-exports.md) | User imports types directly from upstream chain SDKs that `library-exports` now covers. | No — additive cleanup. |

If the user's only signal is "wallet-sdk-core was bumped to v2", **no recipe is needed**. Run `pnpm checkTs`, verify zero `@sodax/wallet-sdk-core` errors, and stop.
