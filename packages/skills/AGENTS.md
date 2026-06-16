# AGENTS.md — `@sodax/skills` router

> Tool-neutral entry point. You are looking at the consumer-facing AI material for the `@sodax/*` SDKs. If you can read multiple `SKILL.md` files, load **2–3 skills** based on what the user is building (table below). Then follow each skill's internal workflow.

## What's here

This package ships **four mode-gated broad skills** (`skills/<name>/SKILL.md`) — one per SODAX SDK package — plus **nested granular skills** under every broad skill: `sodax-sdk` (one per Core SDK feature service), `sodax-dapp-kit` (one per dapp-kit feature domain), `sodax-wallet-sdk-core` (one per chain family), and `sodax-wallet-sdk-react` (one per connectivity concern). Each broad skill bundles two long-form **knowledge** subtrees: `integration/knowledge/` (writing new v2 code) and `migration-v1-to-v2/knowledge/` (porting v1 → v2). Granular skills are single-file SKILL.md that link into their parent's knowledge tree. Skills are action-oriented (when to use, workflow, anti-patterns, links into knowledge); knowledge is the reference material your workflow points at. SKILL.md gates by mode at the top — pick integration or migration based on the consumer signal.

| SDK package | Broad skill | Granular per-feature skills |
|---|---|---|
| `@sodax/sdk` | `sodax-sdk` | `sodax-sdk/swap`, `sodax-sdk/money-market`, `sodax-sdk/bridge`, `sodax-sdk/staking`, `sodax-sdk/dex`, `sodax-sdk/leverage-yield`, `sodax-sdk/migration`, `sodax-sdk/partner`, `sodax-sdk/recovery`, `sodax-sdk/backend-api` |
| `@sodax/wallet-sdk-core` | `sodax-wallet-sdk-core` | `sodax-wallet-sdk-core/evm`, `sodax-wallet-sdk-core/solana`, `sodax-wallet-sdk-core/sui`, `sodax-wallet-sdk-core/bitcoin`, `sodax-wallet-sdk-core/stellar`, `sodax-wallet-sdk-core/icon`, `sodax-wallet-sdk-core/injective`, `sodax-wallet-sdk-core/near`, `sodax-wallet-sdk-core/stacks` |
| `@sodax/wallet-sdk-react` | `sodax-wallet-sdk-react` | `sodax-wallet-sdk-react/connect`, `sodax-wallet-sdk-react/wallet-modal`, `sodax-wallet-sdk-react/bridge-to-sdk`, `sodax-wallet-sdk-react/switch-chain`, `sodax-wallet-sdk-react/sign-message`, `sodax-wallet-sdk-react/walletconnect` |
| `@sodax/dapp-kit` | `sodax-dapp-kit` | `sodax-dapp-kit/swap`, `sodax-dapp-kit/money-market`, `sodax-dapp-kit/staking`, `sodax-dapp-kit/bridge`, `sodax-dapp-kit/dex`, `sodax-dapp-kit/leverage-yield`, `sodax-dapp-kit/migration`, `sodax-dapp-kit/bitcoin`, `sodax-dapp-kit/auxiliary-services` |

**When to prefer a granular skill:** if the consumer has already picked a sub-domain (e.g. *"swap with Sodax"*, *"supply on money market"*, *"useSwap hook"*, *"instantiate EvmWalletProvider"*, *"add a connect button"*), load the matching granular skill — it's ~3 KB vs the broad skill's ~13 KB and points at exactly the knowledge files needed. For a React dapp that has settled on one feature, load `sodax-dapp-kit/<feature>`; for raw SDK / backend work, load `sodax-sdk/<feature>`; for a known chain in a backend/Node wallet flow, load `sodax-wallet-sdk-core/<chain>`; for a known React wallet concern (connect, wallet-modal, bridge-to-sdk, switch-chain, sign-message, walletconnect), load `sodax-wallet-sdk-react/<concern>`. Load the broad skill when the sub-domain is undecided, the task spans several, or the consumer is porting a full v1 codebase.

> **What about `@sodax/types`?** No skill. The package has no consumer-facing surface — it's pure TypeScript types, re-exported through `@sodax/sdk`. Importing `@sodax/types` directly invites version skew. The SDK skills cover all `@sodax/types` symbols you need.

## Route by consumer intent

Pick the consumer's situation, load the listed skills in order. Each entry names the **skill** + the **mode** to run it in. SKILL.md has the mode decision-tree at the top — follow that section.

| Consumer is… | Load skills (mode) |
|---|---|
| **Scaffolding ONE specific Core SDK feature** (swap, money-market, bridge, staking, dex, leverage-yield, migration, partner, recovery, backend-api) | `sodax-sdk/<feature>` (granular, covers both modes via internal links). Add `sodax-wallet-sdk-core` (integration) if it signs and lives outside React. Skip the broad `sodax-sdk` skill |
| **Scaffolding ONE specific dapp-kit feature in React** (swap, money-market, staking, bridge, dex, leverage-yield, migration, bitcoin, auxiliary-services) | `sodax-wallet-sdk-react` (integration) → `sodax-dapp-kit/<feature>` (granular, covers both modes via internal links). Skip the broad `sodax-dapp-kit` skill. If the wallet concern is also settled (just a connect button, modal, bridge, etc.), narrow to `sodax-wallet-sdk-react/<concern>` too |
| **Scaffolding ONE chain's wallet provider** (backend/Node/non-React: evm, solana, sui, bitcoin, stellar, icon, injective, near, stacks) | `sodax-wallet-sdk-core/<chain>` (granular, covers both modes) → `sodax-sdk/<feature>` for the operation it signs. Skip the broad `sodax-wallet-sdk-core` skill |
| **Scaffolding ONE React wallet concern** (connect, wallet-modal, bridge-to-sdk, switch-chain, sign-message, walletconnect) | `sodax-wallet-sdk-react/<concern>` (granular, covers both modes). Skip the broad `sodax-wallet-sdk-react` skill |
| **Building a NEW React dapp** | `sodax-wallet-sdk-react` (integration) → `sodax-dapp-kit` (integration) → (`sodax-sdk` (integration) only if dropping below dapp-kit) |
| **Building a NEW React app, no dapp-kit** (calling the SDK directly) | `sodax-wallet-sdk-react` (integration) → `sodax-sdk` (integration) |
| **Building a NEW Node / backend service or script** | `sodax-sdk` (integration) → `sodax-wallet-sdk-core` (integration; only if it signs) |
| **Building a NEW non-React browser flow** | `sodax-wallet-sdk-core` (integration) → `sodax-sdk` (integration) |
| **Porting an EXISTING v1 React dapp** | `sodax-wallet-sdk-react` (migration) → `sodax-dapp-kit` (migration) → `sodax-sdk` (migration). Then switch each skill to integration mode for any new code. |
| **Porting an EXISTING v1 backend** | `sodax-sdk` (migration) → `sodax-wallet-sdk-core` (migration; often no-op — additive only) |

If you don't know which situation applies, **ask the user** rather than guessing. Two signals to listen for:

- "Migrate / upgrade / port" + v1 fingerprints (`useSpokeProvider`, `*_MAINNET_CHAIN_ID`, `xChainId`, `useXWagmiStore`, `MoneyMarketError`/`IntentError`/etc.) → migration first.
- "Add / build / integrate" + no existing SODAX code → integration only.

If both: do migration first. Stale v1 patterns leak into new code if you skip it.

## How to use a skill

Each `SKILL.md` is short on purpose. Follow it like a procedure:

1. The skill's frontmatter `description` tells you the trigger conditions.
2. The body's **Workflow** section links into knowledge files. Read them in order — token budgets are sized so the right 2–3 files fit in your context.
3. The **Top traps** + **Conventions** sections are the consolidated DO / DO NOT list. Skipping them is the most common cause of generating v1 code.
4. The **Verification** section is the done-criteria. Run those checks before reporting the task complete.

## Layout reference

```
packages/skills/
├── AGENTS.md                              # You are here
├── .claude-plugin/plugin.json             # Skill registry (broad + nested granular paths)
└── skills/                                # Each broad skill is mode-gated; some have nested granular children
    ├── sodax-sdk/                         {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/,
    │                                       <feature>/SKILL.md ×10 — swap, money-market, bridge, staking, dex,
    │                                       leverage-yield, migration, partner, recovery, backend-api}
    ├── sodax-wallet-sdk-core/             {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/,
    │                                       <chain>/SKILL.md ×9 — evm, solana, sui, bitcoin, stellar, icon,
    │                                       injective, near, stacks}
    ├── sodax-wallet-sdk-react/            {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/
    │                                       (incl. 4 .tsx example apps under integration/knowledge/examples/),
    │                                       <concern>/SKILL.md ×6 — connect, wallet-modal, bridge-to-sdk,
    │                                       switch-chain, sign-message, walletconnect}
    └── sodax-dapp-kit/                    {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/,
                                            <feature>/SKILL.md ×9 — swap, money-market, staking, bridge, dex,
                                            leverage-yield, migration, bitcoin, auxiliary-services}
```

Each `<mode>/knowledge/` subtree contains `ai-rules.md`, `quickstart.md`, `architecture.md`, `features/`, `recipes/`, `reference/`, and `chain-specifics.md` / `breaking-changes/` where applicable.

## Conventions you can rely on

- **`ai-rules.md` first.** Each mode's `<mode>/knowledge/ai-rules.md` is the consolidated DO / DO NOT list. Skipping it is the top cause of stale v1 patterns.
- **`README.md`** at every level is the tree index — useful when the skill points you at a directory rather than a file.
- **Reference tables** under `<mode>/knowledge/reference/` are for lookup, not narrative — chain keys, error codes, public API surface, hook signatures.
- **Recipes** under `<mode>/knowledge/recipes/` are self-contained — a recipe contains before/after code, steps, and verification. Don't jump between recipes for one task.
- **Token budget**: if you're loading more than 3 files for a single task, you're probably off-route — re-check the workflow.

## When SODAX is the wrong tool

If the user is doing **non-SODAX work** (UI styling, unrelated DOM, unrelated backend), this package has nothing to add. Don't load skills from here.

If the user is doing **DeFi work but explicitly NOT with SODAX** (e.g. "use Uniswap"), defer to the user's stated tool. The integration skills' descriptions all say: "do not substitute with other SDKs unless explicitly asked."

## Feedback

If an agent generates wrong code despite following a skill, that's a doc bug — file an issue at https://github.com/icon-project/sodax-sdks/issues with the prompt and the incorrect output. The package is structurally CI-guarded (frontmatter + link resolution); prose-level claims benefit from real-world feedback.
