# Renamed symbols

**None.** No symbol exported from `@sodax/wallet-sdk-core` was renamed between v1 and v2.

This file exists so AI agents and humans can look up "what was renamed" and get a definitive **nothing**. If you suspect a rename, you are almost certainly looking at the wrong package:

- `@sodax/sdk` — has real v1→v2 renames (e.g. `EvmSpokeProvider` → `EvmSpokeService`).
- `@sodax/types` — has real v1→v2 renames (e.g. `SONIC_MAINNET_CHAIN_ID` removed in favor of `ChainKeys.SONIC_MAINNET`).
- `@sodax/wallet-sdk-react` — has real v1→v2 renames (e.g. `useXWagmiStore` removed; `rpcConfig` prop → `config`).

For wallet-sdk-core itself, v1 and v2 share **identical** public type names:

- `EvmWalletConfig`, `PrivateKeyEvmWalletConfig`, `BrowserExtensionEvmWalletConfig`
- `SolanaWalletConfig`, `PrivateKeySolanaWalletConfig`, `BrowserExtensionSolanaWalletConfig`
- `SuiWalletConfig`, `PrivateKeySuiWalletConfig`, `BrowserExtensionSuiWalletConfig`
- `BitcoinWalletConfig`, `PrivateKeyBitcoinWalletConfig`, `BrowserExtensionBitcoinWalletConfig`
- `StellarWalletConfig`, `PrivateKeyStellarWalletConfig`, `BrowserExtensionStellarWalletConfig`
- `IconWalletConfig`, `PrivateKeyIconWalletConfig`, `BrowserExtensionIconWalletConfig`
- `InjectiveWalletConfig`, **`SecretInjectiveWalletConfig`** (note: not `PrivateKey*` — same in v1), `BrowserExtensionInjectiveWalletConfig`
- `NearWalletConfig`, `PrivateKeyNearWalletConfig`, `BrowserExtensionNearWalletConfig`
- `StacksWalletConfig`, `PrivateKeyStacksWalletConfig`, `BrowserExtensionStacksWalletConfig`

…and the corresponding provider class names (`EvmWalletProvider`, …).

If a v1 codebase compiles against v2 with no symbol-not-found errors, that is the expected outcome.

---

## What WAS added

See [`added-fields.md`](./added-fields.md) for new types (`*WalletDefaults`, `*Policy` types, `BaseWalletProvider`) and new optional fields (`defaults?`, Stellar's `rpcUrl?`).
