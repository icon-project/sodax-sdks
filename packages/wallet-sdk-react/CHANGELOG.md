# @sodax/wallet-sdk-react

## 2.0.0

### Major Changes

- First stable v2. Near-rewrite of `@sodax/wallet-sdk-react`. Breaking in provider config, hook signatures, store namespace, and chain-class imports.

  **Highlights (v1 → v2):**

  - Configurable chain opt-in — v1 mounted every chain adapter; v2 mounts only the slots you include on `SodaxWalletConfig`.
  - Single source of truth for chain config — v1 spread it across `rpcConfig` / `options` / `initialState`; v2 collapses into one `config` object on `SodaxWalletProvider`, chains nested under `config.chains[ChainKeys.X]`.
  - Store-first hooks — all read a central Zustand store, no chain-specific React context; composable + testable in isolation.
  - Persisted localStorage key `xwagmi-store` unchanged — existing user connections survive the upgrade.

  **Migration guide (v1 → v2):**

  - Start: [migration README](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-wallet-sdk-react/migration-v1-to-v2/knowledge/README.md) · [breaking-changes](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-wallet-sdk-react/migration-v1-to-v2/knowledge/breaking-changes.md)
  - Reference: [config shape](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-wallet-sdk-react/migration-v1-to-v2/knowledge/reference/config.md) · [hooks map](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-wallet-sdk-react/migration-v1-to-v2/knowledge/reference/hooks.md) · [import/path renames](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-wallet-sdk-react/migration-v1-to-v2/knowledge/reference/imports.md)

  **Migration (before → after):** `<SodaxWalletProvider rpcConfig={{ sonic: '…' }}>` → `<SodaxWalletProvider config={{ chains: { [ChainKeys.SONIC_MAINNET]: { rpcUrl: '…' } } }}>`.

### Patch Changes

- Updated dependencies []:
  - @sodax/libs@2.0.0
  - @sodax/types@2.0.0
  - @sodax/wallet-sdk-core@2.0.0
