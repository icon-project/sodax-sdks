# Source folder layout: flat → folder-per-chain

**Affects only deep imports from `src/...`.** Barrel imports (`from '@sodax/wallet-sdk-core'`) are unaffected.

---

## What changed

v1 (`sodax-frontend/packages/wallet-sdk-core`) used a **flat** layout:

```
src/
├── index.ts
└── wallet-providers/
    ├── index.ts
    ├── EvmWalletProvider.ts
    ├── EvmWalletProvider.test.ts
    ├── BTCWalletProvider.ts
    ├── SuiWalletProvider.ts
    ├── IconWalletProvider.ts
    ├── InjectiveWalletProvider.ts
    ├── SolanaWalletProvider.ts
    ├── StellarWalletProvider.ts
    ├── StacksWalletProvider.ts
    └── NearWalletProvider.ts
```

v2 reorganised into a **folder-per-chain** layout, with co-located types and tests:

```
src/
├── index.ts
├── types/                                # NEW — library-exports module
│   ├── index.ts
│   └── library-exports.ts
├── utils/                                # NEW — internal helpers
│   ├── index.ts
│   └── merge.ts
└── wallet-providers/
    ├── index.ts
    ├── BaseWalletProvider.ts             # NEW
    ├── evm/
    │   ├── index.ts
    │   ├── EvmWalletProvider.ts
    │   ├── EvmWalletProvider.test.ts
    │   └── types.ts
    ├── bitcoin/                          # new folder; file name kept as BTCWalletProvider.ts
    │   ├── index.ts
    │   ├── BTCWalletProvider.ts
    │   ├── BTCWalletProvider.test.ts
    │   └── types.ts
    ├── sui/        { …same shape… }
    ├── icon/       { …same shape… }
    ├── injective/  { …same shape… }
    ├── solana/     { …same shape… }
    ├── stellar/    { …same shape… }
    ├── stacks/     { …same shape… }
    └── near/       { …same shape… }
```

Class names and barrel exports are **unchanged**. `BitcoinWalletProvider`, `EvmWalletProvider`, etc. live at the same import path:

```ts
// v1 — works
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';

// v2 — same, works identically
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
```

## Why

Three reasons to fold each chain into a folder:

1. **Co-located types.** Each chain's `*WalletConfig`, `*WalletDefaults`, `*WalletsKit` types now sit next to the provider that consumes them, in a `types.ts` file — easier to navigate.
2. **Internal helpers per chain.** Some chains have non-trivial helper functions (ICON's Hana wallet bridge, EVM's chain-key → viem chain map, Bitcoin's PSBT helpers). Folder layout lets those live without polluting a single shared file.
3. **Future expansion.** Adding a new chain now means dropping a single `src/wallet-providers/<chain>/` folder; the package barrel does not need a corresponding restructure.

## Consumer impact

| User pattern | v1 | v2 |
|---|---|---|
| `import { EvmWalletProvider } from '@sodax/wallet-sdk-core'` | ✅ works | ✅ works |
| `import { BitcoinWalletProvider } from '@sodax/wallet-sdk-core'` | ✅ works | ✅ works |
| `import … from '@sodax/wallet-sdk-core/wallet-providers/EvmWalletProvider'` (deep) | ⚠ never officially supported | ❌ no longer resolves |
| `import … from '@sodax/wallet-sdk-core/src/wallet-providers/EvmWalletProvider'` (raw src) | ⚠ never officially supported | ❌ no longer resolves |

If user code has deep imports, replace with barrel imports.

## How to verify

```bash
# No deep imports
grep -rn "@sodax/wallet-sdk-core/" <user-src> | grep -v "from '@sodax/wallet-sdk-core'"
# expect empty

# Type check passes
pnpm checkTs
```
