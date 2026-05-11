# AGENTS.md — `@sodax/wallet-sdk-react` AI Export

You are a coding agent helping a developer **integrate** or **migrate** the `@sodax/wallet-sdk-react` package. This document is your entry point. Read this first, then route to the right sub-folder.

The files in this `ai-exported/` directory are designed for AI consumption: short, table-heavy, self-contained recipes, and machine-checkable checklists. Human-readable narrative lives in each folder's `README.md`.

---

## Step 1 — Identify the task

| User says... | Path | Start at |
|---|---|---|
| "upgrade to v2", "migrate from v1", "old hooks no longer work", "useXWagmiStore is gone" | **migration** | `migration/ai-rules.md` |
| "add wallet connect", "set up SodaxWalletProvider", "first time using this lib" | **integration** | `integration/ai-rules.md` |
| Looking up a v1 → v2 symbol mapping | direct | `migration/reference/*.md` |
| Looking up a hook signature or available connector | direct | `integration/reference/*.md` |

The package name **did not change** between v1 and v2 — both versions publish as `@sodax/wallet-sdk-react`. Migration is detected by import surface (`useXWagmiStore`, positional hook args, `rpcConfig` / `options` / `initialState` props on `SodaxWalletProvider`), not by package name.

If both signals appear (project has v1 patterns AND wants new features), **migration first, then integration**.

---

## Step 2 — Load the right context

**For migration tasks:**

1. `migration/ai-rules.md` — DO/DON'T + workflow + stop conditions
2. `migration/breaking-changes.md` — narrative WHY behind each change
3. `migration/reference/*.md` — lookup tables (imports, hooks, config, components)
4. `migration/recipes/<task>.md` — paired before/after for the specific use case
5. `migration/checklist.md` — verification loop

**For integration tasks:**

1. `integration/ai-rules.md` — DO/DON'T + workflow
2. `integration/recipes/setup.md` — always read this first (everything else depends on it)
3. `integration/recipes/<task>.md` — task-specific guide
4. `integration/reference/*.md` — API surface lookup

---

## Step 3 — Honor flow-specific stop conditions

Each flow has its own list of conditions that **HARD STOP** code generation and require asking the user:

- Migration stops → [`migration/ai-rules.md`](./migration/ai-rules.md) § "Stop conditions"
- Integration stops → [`integration/ai-rules.md`](./integration/ai-rules.md) § "Stop conditions"

Read the relevant list **before** applying any change. When stopping, quote the offending file/line and present the user with concrete options. Do **not** guess.

Cross-flow signals (true regardless of flow):

- User explicitly requests a behavior that v2 does not support (custom chain not in [`integration/reference/chain-support.md`](./integration/reference/chain-support.md), custom `XService` / `XConnector` subclass with non-trivial logic).
- User mixes both v1 and v2 patterns in new code being written — do migration first, then integration.

---

## Step 4 — Verification protocol

After **every** code change you make:

1. Run `pnpm checkTs` from the user's app root (or the package the change touched).
2. If errors mention `@sodax/wallet-sdk-react`, look up the symbol in `migration/reference/` or `integration/reference/`.
3. If a symbol isn't in any reference file, **stop and ask**. Do not invent migrations.
4. After all errors resolve, mark the relevant items in `migration/checklist.md` (for migrations) or move to the next recipe.

You are **done** when:
- `pnpm checkTs` exits clean for the user's project.
- All items in `migration/checklist.md` are checked (migration only).
- The user has confirmed the changed flow works in their dev environment.

---

## Conventions in this directory

- **Recipes are self-contained.** A recipe file in `recipes/` contains everything needed to apply the change — before/after code, steps, verification. Do not jump between files.
- **Reference files are tables.** `reference/*.md` contains markdown tables and paired code blocks marked `// v1 ❌` and `// v2 ✅`. Treat them as lookup, not narrative.
- **Token budget**: Each file is sized to fit comfortably in your context. If you find yourself loading more than 3 files for a single task, you are probably doing it wrong — re-route via the table above.
- **Single source of truth**: Behavioral / breaking-change *explanations* live only in `migration/breaking-changes.md`. Other files reference it but do not duplicate the prose.

---

## Quick symbol lookup

If the user mentions a symbol you don't recognize, grep these files in order:

```
migration/reference/imports.md      — import path changes
migration/reference/hooks.md        — hook renames + signature changes
migration/reference/config.md       — SodaxWalletProvider config changes
migration/reference/components.md   — component / provider renames
integration/reference/hooks.md      — full v2 hook surface
integration/reference/connectors.md — available wallet connectors per chain
integration/reference/chain-support.md — supported chains + slots
```

If still not found: the symbol may be **internal** (not exported from v2) or **removed**. Ask the user to share the v1 file/line so you can decide.

---

## Package context

- **Name**: `@sodax/wallet-sdk-react` (same package name in v1 and v2)
- **Version target**: v2.x (current).
- **Peer deps**: `react >= 19`, `@tanstack/react-query 5.x`
- **Install**: `pnpm add @sodax/wallet-sdk-react @tanstack/react-query`
- **Audience**: dApp builders integrating multi-chain wallet connectivity (9 chain types: EVM, Solana, Sui, Bitcoin, Stellar, ICON, Injective, NEAR, Stacks).

For internal architecture (only relevant if you're modifying the package itself, not consuming it), see `../CLAUDE.md` in the parent directory.

---

## Pointers

- [`integration/README.md`](./integration/README.md) — start here for new integrations: file index, recommended reading order, install snippet, provider-stack ordering.
- [`migration/README.md`](./migration/README.md) — start here for v1 → v2 ports: file index, reading order, cross-cutting checklist pointer.
- [`integration/recipes/setup.md`](./integration/recipes/setup.md) — install, mount `SodaxWalletProvider`, pick chain slots.
- [`integration/architecture.md`](./integration/architecture.md) — mental model: provider mount tree, frozen config, EVM single-connection, `xChainType` vs `xChainId`.
- [`integration/reference/`](./integration/reference/) — hooks, connectors, chain-support, wallet-brand identifiers lookup tables.
- [`integration/reference/wallet-brands.md`](./integration/reference/wallet-brands.md) — known wallet brand identifiers (`'hana'`, `'phantom'`, `'xverse'`, …) for batch hooks, plus a runtime discovery snippet.
- [`migration/breaking-changes.md`](./migration/breaking-changes.md) — full narrative of every v1 → v2 change.
