# Recipes

Self-contained, task-oriented guides. Each recipe has paired before/after code, prerequisites, and verification steps.

| Recipe | When to use | Depends on |
|---|---|---|
| [`setup-private-key.md`](./setup-private-key.md) | Construct a provider from a raw key (Node scripts, CI, tests). | none |
| [`setup-browser-extension.md`](./setup-browser-extension.md) | Construct a provider from a wallet-extension adapter (consumer dApps). | none |
| [`bridge-to-sdk.md`](./bridge-to-sdk.md) | Pass the provider to `@sodax/sdk` calls. | a setup recipe |
| [`defaults-and-overrides.md`](./defaults-and-overrides.md) | Configure the `defaults` slice and understand shallow-merge semantics. | a setup recipe |
| [`library-exports.md`](./library-exports.md) | Avoid direct deps on `viem`, `@mysten/sui`, etc. by re-importing types from `@sodax/wallet-sdk-core`. | none |
| [`sign-and-broadcast.md`](./sign-and-broadcast.md) | Typical raw-tx flow per chain. | a setup recipe |
| [`testing.md`](./testing.md) | Mock providers in unit tests. | none |

Pick the recipe that matches the user's task. Recipes are intentionally short and self-contained — do **not** chain more than 2 in one apply.
