---
name: sodax-wallet-sdk-react-bridge-to-sdk
description: 'Granular skill for the @sodax/wallet-sdk-react v2 wallet-provider bridge only — useWalletProvider, which turns the connected wallet into a typed IXxxWalletProvider to pass into @sodax/sdk (or @sodax/dapp-kit hooks) for signing. Use when a React dapp has wallet connectivity working and now needs to execute a SODAX operation — e.g. "useWalletProvider", "pass the connected wallet into a Sodax swap", "get IEvmWalletProvider in React", "sign a Sodax tx from React", "feed walletProvider to a dapp-kit mutation". Covers BOTH integration (write new v2 code) and migration (port v1 — single-object params; the deleted useSpokeProvider). Picks via Step 1. Links into the parent sodax-wallet-sdk-react knowledge tree. The consuming side (raw SDK calls / dapp-kit hooks) lives in the sodax-sdk and sodax-dapp-kit skills.'
---

# Bridge to SDK (`wallet-sdk-react` granular skill)

Granular skill for `useWalletProvider` — the single hook that bridges a connected wallet into `@sodax/sdk` / `@sodax/dapp-kit` calls. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration.
2. **Consuming via raw `@sodax/sdk` or `@sodax/dapp-kit` hooks?** Either way `useWalletProvider` returns the same typed provider; the call-shape on the other side differs (load the sibling-package skill — prose pointer below).
3. **Which chain narrowing?** Pass `xChainId` (a chain key) for the narrowest type (`IEvmWalletProvider`, …); `xChainType` for family-level; no arg for the broad `IWalletProvider`.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/recipes/setup.md`](../integration/knowledge/recipes/setup.md) — prerequisite: provider mounted, chain slots declared.
3. [`../integration/knowledge/recipes/bridge-to-sdk.md`](../integration/knowledge/recipes/bridge-to-sdk.md) — the full pattern: narrow with `useWalletProvider({ xChainId })`, pass into the SDK call with `raw: false`.
4. Lookups → [`../integration/knowledge/reference/hooks.md`](../integration/knowledge/reference/hooks.md) (wallet-provider bridge section).

### Bridge-specific anti-patterns

- **Casting the return of `useWalletProvider`.** Use the chain-key narrowing pattern (pass a specific `xChainId`) to get the typed `IXxxWalletProvider` without `as` — the hook's broad-union return is intentional.
- **Passing both `xChainId` and `xChainType`.** Mutually exclusive.
- **Reaching for the deleted v1 `useSpokeProvider`.** Gone — pass the `useWalletProvider(...)` result directly into the SDK / dapp-kit call (`{ raw: false, walletProvider }`).
- **Forgetting the `undefined` case.** `useWalletProvider` returns `undefined` when the chain is disabled or no wallet is connected — guard before passing it on.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../migration-v1-to-v2/knowledge/breaking-changes.md`](../migration-v1-to-v2/knowledge/breaking-changes.md) — single-object hook params; the deleted store/spoke-provider patterns.
3. Symbol lookups → [`../migration-v1-to-v2/knowledge/reference/hooks.md`](../migration-v1-to-v2/knowledge/reference/hooks.md).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. `useWalletProvider` is narrowed via `xChainId` (no `as` cast on its return).
3. The provider's `undefined` case is guarded before the SDK call.
4. No `useSpokeProvider` references (migration only).

## Related skills (same family)

- [`../connect/SKILL.md`](../connect/SKILL.md) — get the wallet connected first.
- [`../switch-chain/SKILL.md`](../switch-chain/SKILL.md) — ensure the EVM wallet is on the right network before signing.

For multi-feature work, load the broad [`sodax-wallet-sdk-react` skill](../SKILL.md).

## The consuming side (different package family)

This skill produces the `walletProvider`; it does **not** make the SODAX call. For the raw SDK call shape (`{ raw: false, walletProvider }`), **also load the `sodax-sdk` skill (integration mode)**. For React Query hooks that take `walletProvider` through `mutate(vars)`, **also load the `sodax-dapp-kit` skill (integration mode)**.
