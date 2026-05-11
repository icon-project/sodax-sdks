# Migration reference — `@sodax/dapp-kit` v1 → v2

Lookup tables for the v1 → v2 delta. Skim during migration to confirm specific renames or removals.

| File | What's in it |
|---|---|
| [`deleted-hooks.md`](deleted-hooks.md) | v1 hooks that no longer exist in v2 (`useSpokeProvider`, `invalidateMmQueries`, legacy `useMigrate`-style API). |
| [`renamed-hooks.md`](renamed-hooks.md) | Hooks whose name or signature changed (rare — most renames are field-level). |
| [`error-shape-crosswalk.md`](error-shape-crosswalk.md) | v1 error class names → v2 `SodaxError<C>` mapping; how thrown errors look at the consumer level. |

For SDK-level reference (deleted exports, renames, error code crosswalk), see [`../../../../sdk/ai-exported/migration/reference/`](../../../../sdk/ai-exported/migration/reference/) — the underlying SDK has its own reference tree.

## Pair

This `migration/reference/` tree mirrors [`../../integration/reference/`](../../integration/reference/) (which documents v2 directly). When you need both "what does v2 do" and "what changed from v1" — open both.
