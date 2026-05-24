# Knowledge tree — `@sodax/wallet-sdk-core`

Long-form knowledge supporting the `@sodax/wallet-sdk-core` skills under `@sodax/skills`. The action-oriented entry points are the SKILL.md files in the sibling `skills/` directory:

- New code → `packages/skills/skills/sodax-wallet-sdk-core-integration/SKILL.md`
- Porting v1 → `packages/skills/skills/sodax-wallet-sdk-core-migration/SKILL.md`

**Don't read this tree top-to-bottom.** Load files from the **Workflow** section of the relevant SKILL.md.

## Package summary

`@sodax/wallet-sdk-core` is the **low-level** wallet layer of the SODAX stack — one provider class per chain family (9 in total: EVM, Solana, Sui, Bitcoin, Stellar, ICON, Injective, NEAR, Stacks). Each class accepts either a **private-key** config (server-side scripts, CI, Node) or a **browser-extension** config (consumer dApps with pre-built clients/wallet kits), signs transactions, and broadcasts them.

It is **not** a React layer (that is `@sodax/wallet-sdk-react`) and **not** a hooks layer (that is `@sodax/dapp-kit`). Most React consumers never touch this package directly — they get a typed `IXxxWalletProvider` via `useWalletProvider(...)` and hand it to `@sodax/sdk` calls. Direct usage of `wallet-sdk-core` is the right choice for backend / Node scripts, custom non-React browser flows, and tests that need to sign with a deterministic key.

The package name did **not** change across versions — both v1 and v2 publish as `@sodax/wallet-sdk-core`. All v1 → v2 surface changes are additive (no renames, no deletions). The only mechanical migration is replacing deep imports from v1's flat `wallet-providers/*.ts` layout with barrel imports.

## Layout

```
knowledge/wallet-sdk-core/
├── AGENTS.md                  # You are here
├── integration/               # New code (per-chain provider setup)
│   ├── README.md
│   ├── ai-rules.md
│   ├── architecture.md        # BaseWalletProvider, discriminants, defaults merge
│   ├── quickstart.md          # Minimal per-chain copy-paste examples
│   ├── features/              # Per-chain config table, methods, gotchas (9 chains)
│   ├── recipes/               # setup-private-key, setup-browser-extension, sign-and-broadcast, defaults-and-overrides, library-exports, bridge-to-sdk, testing
│   └── reference/             # Public API, provider classes, interfaces, chain support, glossary
└── migration/                 # Additive v1 → v2 (mostly deep-import → barrel cleanup)
    ├── README.md
    ├── ai-rules.md
    ├── checklist.md
    ├── breaking-changes/      # folder-layout, defaults-config, base-wallet-provider, library-exports
    ├── recipes/               # adopt-defaults, adopt-library-exports (optional)
    └── reference/             # added-fields, deleted-exports (empty), renamed-symbols (empty), return-shapes
```

## Cross-references

- SDK calls: `packages/skills/knowledge/sdk/integration/recipes/raw-tx-flow.md` and `signed-tx-flow.md` show how the wallet provider plugs into `@sodax/sdk` payloads.
- React equivalent: `packages/skills/knowledge/wallet-sdk-react/` (use `useWalletProvider({ xChainId })` instead of constructing providers directly).
