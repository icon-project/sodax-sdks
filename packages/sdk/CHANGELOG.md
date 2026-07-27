# @sodax/sdk

## 2.0.0

### Major Changes

- First stable v2. Deep architectural reshape of `@sodax/sdk` — breaking across the public surface.

  **Highlights (v1 → v2):**

  - Per-chain `*SpokeProvider` classes removed. Route by chain key: pass `srcChainKey: ChainKeys.ETHEREUM_MAINNET` + `walletProvider` inside the params object; SDK dispatches to the internal spoke service. Consumers never construct a spoke provider.
  - `Result<T, SodaxError<C>>` returned from every async public method. v1 throw-on-error gone.
  - One canonical error class `SodaxError<C>` (closed 13-code reason vocab + `feature` field). Per-module unions (`MoneyMarketError`, `IntentError`, `StakingError`, `BridgeError`, `MigrationError`, …) deleted; discriminate on `(error.feature, error.code)`, cross-bundle check via `isSodaxError`.
  - `WalletProviderSlot<K, Raw>` discriminated union: signed execution = `{ raw: false, walletProvider }` (chain-narrowed), raw-tx build = `{ raw: true }`. Compile-time enforced.
  - `ConfigService` is the lookup surface — `sodax.config.*`, backend-driven after `await sodax.config.initialize()`, packaged defaults as fallback. `hubAssets` and `*_MAINNET_CHAIN_ID` constants deleted. `Token` → `XToken` (carries `chainKey`, `vault`, `hubAsset`); token `xChainId` → `chainKey`.
  - Opt-in structured analytics (`new Sodax({ analytics })`) alongside `logger`.
  - Fix: merged bnUSD reserve pins `lastUpdateTimestamp` to the debt token's, keeping borrow index, rate, and timestamp consistent (was over-stating debt).

  **Migration guide (v1 → v2):**

  - Start: [migration README](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/migration-v1-to-v2/knowledge/README.md) · [ai-rules](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/migration-v1-to-v2/knowledge/ai-rules.md) · [17-step checklist](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/migration-v1-to-v2/knowledge/checklist.md)
  - Breaking changes: [type-system](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/migration-v1-to-v2/knowledge/breaking-changes/type-system.md) · [architecture](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/migration-v1-to-v2/knowledge/breaking-changes/architecture.md) · [result-and-errors](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/migration-v1-to-v2/knowledge/breaking-changes/result-and-errors.md)
  - Reference: [deleted exports](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/migration-v1-to-v2/knowledge/reference/deleted-exports.md) · [error-code crosswalk](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/migration-v1-to-v2/knowledge/reference/error-code-crosswalk.md) · [chain-id map](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/CHAIN_ID_MIGRATION.md)

  **Migration (before → after):** `const spoke = new EvmSpokeProvider(...); await sodax.swaps.createIntent(params, spoke)` → `const r = await sodax.swaps.createIntent({ ...params, srcChainKey: ChainKeys.ETHEREUM_MAINNET, walletProvider, raw: false }); if (!r.ok) handle(r.error)`.

### Patch Changes

- Validate ICON address type and length in `encodeAddress` (SWAP-M-1) — reject malformed ICON destinations before hex-decoding.
- Updated dependencies []:
  - @sodax/libs@2.0.0
  - @sodax/swaps-api@2.0.0
  - @sodax/types@2.0.0
