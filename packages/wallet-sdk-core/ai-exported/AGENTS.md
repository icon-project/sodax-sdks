# AGENTS.md — `@sodax/wallet-sdk-core` AI Export

You are a coding agent helping a developer **integrate** or **migrate** the `@sodax/wallet-sdk-core` package. This document is your entry point. Read this first, then route to the right sub-folder.

The files in this `ai-exported/` directory are designed for AI consumption: short, table-heavy, self-contained recipes, and machine-checkable checklists. Human-readable narrative lives in each folder's `README.md`.

---

## What this package is

`@sodax/wallet-sdk-core` is the **low-level** wallet layer of the SODAX stack — one provider class per chain family (9 in total: EVM, Solana, Sui, Bitcoin, Stellar, ICON, Injective, NEAR, Stacks). Each class accepts either a **private-key** config (server-side scripts, CI, Node) or a **browser-extension** config (consumer dApps with pre-built clients/wallet kits), signs transactions, and broadcasts them.

It is **not** a React layer (that is `@sodax/wallet-sdk-react`) and **not** a hooks layer (that is `@sodax/dapp-kit`). Most React consumers never touch this package directly — they get a typed `IXxxWalletProvider` via `useWalletProvider(...)` and hand it to `@sodax/sdk` calls. Direct usage of `wallet-sdk-core` is the right choice for:

- Backend / Node scripts (CI tests, indexers, bots).
- Custom browser flows that don't use React.
- Tests that need to sign with a deterministic key.

---

## Step 1 — Identify the task

| User says... | Path | Start at |
|---|---|---|
| "sign a tx from a script", "instantiate `EvmWalletProvider`", "first time using this lib" | **integration** | `integration/ai-rules.md` |
| "configure default gas", "set up `defaults`", "shallow merge surprised me" | **integration** | `integration/recipes/defaults-and-overrides.md` |
| "where do I import `WalletClient` / `SuiClient` from", "avoid direct viem dep" | **integration** | `integration/recipes/library-exports.md` |
| "upgrade from v1 / sodax-frontend", "bump from older RC" | **migration** | `migration/ai-rules.md` |
| Deep import from `@sodax/wallet-sdk-core/wallet-providers/EvmWalletProvider` broke | **migration** | `migration/breaking-changes/folder-layout.md` |
| Looking up a provider class or its config shape | direct | `integration/reference/provider-classes.md` |
| Looking up the discriminated union shape per chain | direct | `integration/features/<chain>.md` |

The package name **did not change** across versions — both v1 and v2 publish as `@sodax/wallet-sdk-core`. **All v1→v2 surface changes are additive** — class names, config-type names, and config shapes are identical. The only mechanical migration is replacing deep imports from v1's flat `wallet-providers/*.ts` layout with barrel imports.

If a project does anything more than that at the wallet-sdk-core surface, you are almost certainly looking at an `@sodax/sdk` / `@sodax/types` migration, not this one. Route accordingly.

---

## Step 2 — Load the right context

**For integration tasks:**

1. `integration/ai-rules.md` — DO/DON'T + workflow + stop conditions
2. `integration/architecture.md` — mental model (BaseWalletProvider, discriminants, defaults merge)
3. `integration/quickstart.md` — copy-paste minimal example for the chain you need
4. `integration/features/<chain>.md` — per-chain config table, methods, gotchas
5. `integration/recipes/<task>.md` — task-specific guide (setup-private-key, bridge-to-sdk, …)
6. `integration/reference/*.md` — full barrel exports, interfaces, chain support

**For migration tasks:**

1. `migration/ai-rules.md` — DO/DON'T + workflow. The headline: **v1 code drops in unchanged.** No mandatory edits at the wallet-sdk-core surface.
2. `migration/README.md` — what (additively) changed, read order, TL;DR
3. `migration/breaking-changes/*.md` — narrative WHY behind each additive shift (folder layout, base-class, defaults, library-exports)
4. `migration/reference/*.md` — confirm no renames / no deletions exist
5. `migration/recipes/<task>.md` — paired before/after for **optional** cleanup (adopt-defaults, adopt-library-exports)
6. `migration/checklist.md` — verification loop

---

## Step 3 — Honor flow-specific stop conditions

Each flow has its own list of conditions that **HARD STOP** code generation and require asking the user:

- Migration stops → [`migration/ai-rules.md`](./migration/ai-rules.md) § "Stop conditions"
- Integration stops → [`integration/ai-rules.md`](./integration/ai-rules.md) § "Stop conditions"

Read the relevant list **before** applying any change. When stopping, quote the offending file/line and present the user with concrete options. Do **not** guess.

Cross-flow signals (true regardless of flow):

- User asks for a chain family not in [`integration/reference/chain-support.md`](./integration/reference/chain-support.md). Adding a new chain is a maintainer task, not user-app integration.
- User wants to extend `BaseWalletProvider` directly. That is a maintainer-only path — confirm scope before writing code.

---

## Step 4 — Verification protocol

After **every** code change you make:

1. Run `pnpm checkTs` from the user's app root (or the package the change touched).
2. If errors mention `@sodax/wallet-sdk-core`, look up the symbol in `integration/reference/` or `migration/reference/`.
3. If a symbol isn't in any reference file, **stop and ask**. Do not invent migrations.
4. After all errors resolve, mark the relevant items in `migration/checklist.md` (for migrations) or move to the next recipe.

You are **done** when:
- `pnpm checkTs` exits clean for the user's project.
- All items in `migration/checklist.md` are checked (migration only).
- The user has confirmed the changed flow works in their dev / test environment.

---

## Conventions in this directory

- **Recipes are self-contained.** A recipe file in `recipes/` contains everything needed to apply the change — before/after code, steps, verification. Do not jump between files.
- **Reference files are tables.** `reference/*.md` contains markdown tables and paired code blocks. Treat them as lookup, not narrative.
- **Token budget**: Each file is sized to fit comfortably in your context. If you find yourself loading more than 3 files for a single task, you are probably doing it wrong — re-route via the table above.
- **Single source of truth**: Behavioral / breaking-change *explanations* live only in `migration/breaking-changes/*.md`. Other files reference them but do not duplicate the prose.

---

## Quick symbol lookup

If the user mentions a symbol you don't recognize, grep these files in order:

```
integration/reference/public-api.md       — every named export from the package
integration/reference/provider-classes.md — provider class + config + interface mapping
integration/reference/interfaces.md       — IXxxWalletProvider method signatures
integration/reference/chain-support.md    — chain family → provider + dependencies
migration/reference/renamed-symbols.md    — confirms zero renames between v1 and v2
migration/reference/deleted-exports.md    — confirms zero deletions between v1 and v2
migration/reference/added-fields.md       — additive `defaults` / `*WalletDefaults` / `*Policy` types
```

If still not found: the symbol may be **internal** (not exported from the package root) or **removed**. Ask the user to share the source file/line so you can decide.

---

## Package context

- **Name**: `@sodax/wallet-sdk-core`
- **Version target**: latest RC / stable on npm.
- **Peer deps**: none — chain SDKs are direct dependencies and consumers can re-import types via `library-exports`.
- **Install**: `pnpm add @sodax/wallet-sdk-core`
- **Runtime**: Node ≥ 18 + browser (tsup `platform: 'neutral'`).
- **Audience**: backend engineers, script authors, and React-layer authors building higher-level wrappers (`@sodax/wallet-sdk-react`).

---

## Pointers

- [`integration/README.md`](./integration/README.md) — start here for new integrations: file index, recommended reading order, install snippet, dual-config overview.
- [`migration/README.md`](./migration/README.md) — start here for upgrades: file index, reading order, cross-cutting checklist pointer.
- [`integration/quickstart.md`](./integration/quickstart.md) — minimal end-to-end example per chain.
- [`integration/architecture.md`](./integration/architecture.md) — mental model: `BaseWalletProvider`, defaults shallow merge, dual-config discriminants, `library-exports`.
- [`integration/features/`](./integration/features/) — per-chain config table, methods, gotchas (one file per chain).
- [`integration/reference/`](./integration/reference/) — public API, provider classes, interfaces, chain support, glossary.
- [`migration/breaking-changes/`](./migration/breaking-changes/) — narrative WHY behind each version-to-version shift.
