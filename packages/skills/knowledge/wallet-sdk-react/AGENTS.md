# Knowledge tree — `@sodax/wallet-sdk-react`

Long-form knowledge supporting the `@sodax/wallet-sdk-react` skills under `@sodax/skills`. The action-oriented entry points are the SKILL.md files in the sibling `skills/` directory:

- New code → `packages/skills/skills/sodax-wallet-sdk-react-integration/SKILL.md`
- Porting v1 → `packages/skills/skills/sodax-wallet-sdk-react-migration/SKILL.md`

**Don't read this tree top-to-bottom.** Load files from the **Workflow** section of the relevant SKILL.md.

## Package summary

`@sodax/wallet-sdk-react` is the React wallet-connectivity layer for SODAX dapps. Covers `SodaxWalletProvider` setup, hook-based connect/disconnect/account/signing UX across 9 chain types (EVM, Solana, Sui, Bitcoin, Stellar, ICON, Injective, NEAR, Stacks), headless wallet-modal primitives, WalletConnect for non-injected wallets (Fireblocks/Ledger/mobile), and `useWalletProvider` for bridging the connected wallet into `@sodax/sdk` calls.

Audience: dApp builders. Backend / Node code uses `@sodax/wallet-sdk-core` directly instead.

The package name **did not** change between v1 and v2. Migration is detected by import surface (`useXWagmiStore`, positional hook args, removed `rpcConfig` / `options` / `initialState` props on `SodaxWalletProvider`), not by package name.

Peer deps: `react >= 19`, `@tanstack/react-query 5.x`.

## Layout

```
knowledge/wallet-sdk-react/
├── AGENTS.md                  # You are here
├── integration/               # New code
│   ├── README.md
│   ├── ai-rules.md
│   ├── architecture.md        # Provider mount tree, frozen config, EVM single-connection, xChainType vs xChainId
│   ├── quickstart.md
│   ├── examples/              # 4 working .tsx app shells (minimal-evm, multi-chain-modal, nextjs-app-router, walletconnect-setup)
│   ├── recipes/               # 10 recipes (setup, connect-button, multi-chain-modal, walletconnect-setup, bridge-to-sdk, sign-message, switch-chain, batch-operations, chain-detection, sub-path-imports)
│   └── reference/             # api-surface, chain-support, connectors, hooks, wallet-brands
└── migration/                 # v1 → v2
    ├── README.md
    ├── ai-rules.md
    ├── checklist.md
    ├── breaking-changes.md    # Full narrative of every v1 → v2 change
    ├── recipes/               # connect-button, multi-chain-modal, ssr-setup, walletconnect-migration
    └── reference/             # imports, hooks, config, components (v1 → v2 mappings)
```

## Cross-references

- SDK calls: `packages/skills/knowledge/sdk/integration/recipes/signed-tx-flow.md` shows how the connected wallet plugs into SDK payloads via `useWalletProvider`.
- Lower-level wallet providers: `packages/skills/knowledge/wallet-sdk-core/` (the underlying provider classes that `useWalletProvider` returns).
- Higher-level feature hooks: `packages/skills/knowledge/dapp-kit/` (React hooks wrapping `@sodax/sdk` — almost every wallet-sdk-react consumer also uses dapp-kit).
