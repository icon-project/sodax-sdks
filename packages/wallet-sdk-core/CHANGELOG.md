# @sodax/wallet-sdk-core

## 2.0.0

### Minor Changes

- v2 is backwards-compatible — v1 consumer code is drop-in, nothing removed or renamed. All changes additive; no mandatory edit.

  **Highlights (v1 → v2):**

  - Identical class names, config type names, config shapes, and public method signatures as v1.
  - Added (all optional): `defaults` config on every `*WalletConfig`; `library-exports` (type re-exports so consumers can drop direct `viem` / `@mysten/sui` / `@stellar/stellar-sdk` deps for type-only use); `BaseWalletProvider<TDefaults>` shared base (internal); `*WalletDefaults` / `*Policy` types; folder-per-chain source layout (only matters if you deep-imported from `src/`).
  - Version aligned to the `@sodax/*` suite (fixed release group).

  **Migration guide (v1 → v2):** drop-in upgrade is the default; adopt the additive features only if you want them.

  - [migration README](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-wallet-sdk-core/migration-v1-to-v2/knowledge/README.md) · [additive changes](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-wallet-sdk-core/migration-v1-to-v2/knowledge/breaking-changes/README.md)
  - Optional cleanups: [adopt `defaults`](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-wallet-sdk-core/migration-v1-to-v2/knowledge/recipes/adopt-defaults.md) · [adopt `library-exports`](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-wallet-sdk-core/migration-v1-to-v2/knowledge/recipes/adopt-library-exports.md)

### Patch Changes

- Updated dependencies []:
  - @sodax/libs@2.0.0
  - @sodax/types@2.0.0
