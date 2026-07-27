# @sodax/types

## 2.0.0

### Major Changes

- First stable v2. Breaking type-surface reshape. Consumed via the `@sodax/sdk` re-export — import these from `@sodax/sdk`, not `@sodax/types` directly.

  **Highlights (v1 → v2):**

  - `ChainKeys.*` string-literal chain keys replace numeric/string chain ids and every `*_MAINNET_CHAIN_ID` constant (deleted). `ChainKeys.ICON_MAINNET === '0x1.icon'` (a string).
  - `Token` → `XToken` (now carries `chainKey`, `vault`, `hubAsset`); token field `xChainId` → `chainKey`. `AddressType` → `BtcAddressType`.
  - Canonical `SodaxError<C>` + closed 13-code reason vocab + `SodaxFeature` taxonomy replace the per-module error unions.
  - New type machinery: `Result<T>`, `WalletProviderSlot<K, Raw>`, `GetWalletProviderType<K>`, `GetChainType<K>`, `TxReturnType<K, Raw>`.
  - `hubAssets` static map deleted. `SodaxOptions` gains `analytics` alongside `logger`/`fee`.
  - `CONFIG_VERSION` incremented.

  **Migration guide (v1 → v2):** `@sodax/types` has no standalone skill (importing it directly invites version skew). Follow the `@sodax/sdk` migration tree:

  - [type-system breaking changes](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/migration-v1-to-v2/knowledge/breaking-changes/type-system.md) · [chain-id map](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/CHAIN_ID_MIGRATION.md)

  **Migration (before → after):** `import { BSC_MAINNET_CHAIN_ID } from '@sodax/types'` → `import { ChainKeys } from '@sodax/sdk'; ChainKeys.BSC_MAINNET`. `Token` / `token.xChainId` → `XToken` / `token.chainKey`.
