---
name: sodax-wallet-sdk-core-migration
description: Port EXISTING `@sodax/wallet-sdk-core` consumer code across versions. v1 → v2 changes are additive — same class names, same config-type names, same config shapes. The only mechanical migration is replacing deep imports from v1's flat `wallet-providers/<chain>.ts` layout with barrel imports, plus optionally adopting the new `defaults` field and re-imported library types. Use when a project imports from `@sodax/wallet-sdk-core/wallet-providers/…`, when bumping from an older RC, or when adopting the new additive `defaults` / `*WalletDefaults` / `*Policy` fields. Most projects don't need this — if a project does anything more than the deep-import cleanup at the wallet-sdk-core surface, the real migration target is probably `@sodax/sdk` or `@sodax/types`.
---

# When to use this skill

Pick this skill ONLY if you see one of these patterns:

- Deep imports: `import { … } from '@sodax/wallet-sdk-core/wallet-providers/EvmWalletProvider'` (or similar per-chain file).
- Bumping `@sodax/wallet-sdk-core` from an older RC and wanting to adopt new additive features (`defaults`, `*WalletDefaults`, `*Policy` types).

The package name **did not change** across versions. Class names, config-type names, and config shapes are **identical** v1 → v2. **No mandatory edits** at the wallet-sdk-core surface — v1 code drops in unchanged.

If a project does more than the deep-import cleanup at this surface, the real migration target is almost certainly `@sodax/sdk` (chain-key renames, Result<T>, error model) or `@sodax/types`. Route to `sodax-sdk-migration` instead.

# Workflow

1. Read [`../../knowledge/wallet-sdk-core/migration/ai-rules.md`](../../knowledge/wallet-sdk-core/migration/ai-rules.md) — DO / DON'T + workflow. **The headline: v1 code drops in unchanged.**
2. Read [`../../knowledge/wallet-sdk-core/migration/README.md`](../../knowledge/wallet-sdk-core/migration/README.md) — what (additively) changed, read order, TL;DR.
3. Read the breaking-change writeups under [`breaking-changes/`](../../knowledge/wallet-sdk-core/migration/breaking-changes/) — `folder-layout.md` (deep-import → barrel), `defaults-config.md`, `base-wallet-provider.md`, `library-exports.md`.
4. For mechanical changes, apply the recipes in [`recipes/`](../../knowledge/wallet-sdk-core/migration/recipes/) — `adopt-defaults.md`, `adopt-library-exports.md`. **Both are optional** — they're cleanup paths, not requirements.
5. Confirm no renames / deletions exist by checking [`reference/`](../../knowledge/wallet-sdk-core/migration/reference/) — `renamed-symbols.md` (empty), `deleted-exports.md` (empty), `added-fields.md` (additive new surface).
6. Verify with [`checklist.md`](../../knowledge/wallet-sdk-core/migration/checklist.md).

# Top mechanical changes

1. **Deep imports → barrel imports.** Replace `import { EvmWalletProvider } from '@sodax/wallet-sdk-core/wallet-providers/EvmWalletProvider'` with `import { EvmWalletProvider } from '@sodax/wallet-sdk-core'`. The flat `wallet-providers/*.ts` layout is gone.
2. **(Optional) Re-import chain SDK types from the barrel.** Replace direct imports of `WalletClient` (viem), `SuiClient` (@mysten/sui), etc. with re-exports from `@sodax/wallet-sdk-core`. Removes the underlying SDK as a direct dep, eliminates version skew. See `recipes/adopt-library-exports.md`.
3. **(Optional) Adopt `defaults` field.** New `defaults` (shallow-merge) field on each provider's config lets you set per-method overrides centrally. See `recipes/adopt-defaults.md`.

# Top traps to avoid

1. **Treating this as a real migration.** It isn't — v1 code drops in unchanged at the wallet-sdk-core surface. If the consumer's compile errors point at this package, look one layer deeper — they're almost certainly `@sodax/types` renames bleeding through (e.g. `xChainId` → `chainKey`) and the real fix is in `@sodax/sdk`'s migration.
2. **Extending `BaseWalletProvider` in consumer code.** That's a maintainer path. If a project subclasses it, scope confirmation with the user before touching anything.

# Stop conditions (defer to user)

| Signal | Why stop |
|---|---|
| Compile errors mention `@sodax/sdk` or `@sodax/types` symbols | Not this migration. Route to `sodax-sdk-migration`. |
| Project extends `BaseWalletProvider` with non-trivial logic | Maintainer-only path. Confirm scope first. |
| User wants a chain family not in `integration/reference/chain-support.md` | Adding a new chain is a maintainer task. |

# Verification

```bash
pnpm tsc --noEmit   # must exit clean
# No leftover deep imports from v1's flat layout:
grep -rE "from '@sodax/wallet-sdk-core/wallet-providers/" src/   # empty
```

# Related skills

- `sodax-wallet-sdk-core-integration` — write new code (more relevant than this skill for most projects).
- `sodax-sdk-migration` — the SDK-side migration is where the real v1 → v2 work happens.
