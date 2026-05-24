# AGENTS.md — `@sodax/skills` router

> Tool-neutral entry point. You are looking at the consumer-facing AI material for the `@sodax/*` SDKs. If you can read multiple `SKILL.md` files, load **2–3 skills** based on what the user is building (table below). Then follow each skill's internal workflow.

## What's here

This package ships **four mode-gated skills** (`skills/<name>/SKILL.md`) — one per SODAX SDK package. Each skill bundles two long-form **knowledge** subtrees: `integration/knowledge/` (writing new v2 code) and `migration-v1-to-v2/knowledge/` (porting v1 → v2). Skills are action-oriented (when to use, workflow, anti-patterns, links into knowledge); knowledge is the reference material your workflow points at. SKILL.md gates by mode at the top — pick integration or migration based on the consumer signal.

| SDK package | Skill |
|---|---|
| `@sodax/sdk` | `sodax-sdk` |
| `@sodax/wallet-sdk-core` | `sodax-wallet-sdk-core` |
| `@sodax/wallet-sdk-react` | `sodax-wallet-sdk-react` |
| `@sodax/dapp-kit` | `sodax-dapp-kit` |

> **What about `@sodax/types`?** No skill. The package has no consumer-facing surface — it's pure TypeScript types, re-exported through `@sodax/sdk`. Importing `@sodax/types` directly invites version skew. The SDK skills cover all `@sodax/types` symbols you need.

## Route by consumer intent

Pick the consumer's situation, load the listed skills in order. Each entry names the **skill** + the **mode** to run it in. SKILL.md has the mode decision-tree at the top — follow that section.

| Consumer is… | Load skills (mode) |
|---|---|
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
├── .claude-plugin/plugin.json             # Skill registry (4 entries)
└── skills/                                # Each skill is mode-gated: SKILL.md + two knowledge subtrees
    ├── sodax-sdk/                         {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/}
    ├── sodax-wallet-sdk-core/             {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/}
    ├── sodax-wallet-sdk-react/            {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/ — incl. 4 .tsx example apps under integration/knowledge/examples/}
    └── sodax-dapp-kit/                    {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/}
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
