# Knowledge tree — `@sodax/sdk`

Long-form knowledge supporting the `@sodax/sdk` skills under `@sodax/skills`. The action-oriented entry points are the SKILL.md files in the sibling `skills/` directory:

- New code → `packages/skills/skills/sodax-sdk-integration/SKILL.md`
- Porting v1 → `packages/skills/skills/sodax-sdk-migration/SKILL.md`

**Don't read this tree top-to-bottom.** Load files from the **Workflow** section of the relevant SKILL.md — token budgets are sized so the right 2–3 files fit in your context.

## Package summary

`@sodax/sdk` is the official SDK for SODAX, a cross-chain DeFi platform built on a hub-and-spoke architecture (Sonic is the hub; 19 spoke chains across EVM and non-EVM ecosystems). The SDK provides cross-chain swaps (intent-based via solver), lending/borrowing (money market), staking, bridging, concentrated-liquidity DEX, ICX/bnUSD/BALN migration, and partner-fee operations. It is runtime-agnostic and runs in Node.js, browsers, and bundled apps.

This package is **v2**. v2 was a deep architectural reshape of v1 — chain-key driven routing replaced per-chain provider classes; `Result<T>` replaced throwing methods; `SodaxError<C>` replaced module-specific error unions; `WalletProviderSlot<K, Raw>` replaced ad-hoc wallet/raw branching; `ConfigService` replaced static lookup tables. Code written against v1 will not compile against v2.

## Layout

```
knowledge/sdk/
├── AGENTS.md                      # You are here
├── integration/                   # New v2 code
│   ├── README.md                  # Index for this tree
│   ├── ai-rules.md                # DO / DO NOT / workflow — read before per-feature docs
│   ├── quickstart.md              # Install + initialize + first-run troubleshooting
│   ├── architecture.md            # Every v2 design concept (TOC-navigable)
│   ├── features/                  # One file per feature service (swap, money-market, staking, bridge, dex, icx-bnusd-baln, auxiliary-services)
│   ├── recipes/                   # One file per pattern (init, result/errors, raw, signed, narrowing, testing, gas, backend-init)
│   ├── reference/                 # One file per table (chain keys, wallet providers, error codes, public API, glossary)
│   └── chain-specifics.md         # Non-EVM quirks (Stellar trustline, BTC PSBT, Solana PDA, ICON, NEAR)
└── migration/                     # Port v1 → v2
    ├── README.md
    ├── ai-rules.md
    ├── breaking-changes/          # type-system / architecture / result-and-errors
    ├── features/                  # Per-feature migration playbooks
    └── recipes.md                 # Codemods + error-shape adapter + Result adapter
```

## Cross-references

- Higher-level React layer: `packages/skills/knowledge/dapp-kit/` (the `@sodax/dapp-kit` knowledge tree).
- Wallet provider impls: `packages/skills/knowledge/wallet-sdk-core/` (Node/script signing) and `packages/skills/knowledge/wallet-sdk-react/` (React).
