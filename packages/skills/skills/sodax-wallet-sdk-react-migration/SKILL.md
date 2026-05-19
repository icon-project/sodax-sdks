---
name: sodax-wallet-sdk-react-migration
description: Port EXISTING v1 `@sodax/wallet-sdk-react` consumer code to v2 — the store hook was removed from the public API (each `useXWagmiStore(state => state.X)` selector must be replaced with a public hook like `useXServices` / `useXService({ xChainType })` / `useXConnections` / `useXConnection({ xChainType })`; do NOT rename to `useXWalletStore` — the v2 barrel does not export it), hook signatures unified to single-object params, `SodaxWalletProvider` props reshaped (the old `rpcConfig` / `options` / `initialState` were removed in favor of a single `config: SodaxWalletConfig` object), and the chain-slot wrapper (`chains: { EVM, SOLANA, ... }`) was flattened so chain-type slots are top-level on `SodaxWalletConfig`. Use whenever a React dapp imports `useXWagmiStore`, calls hooks with positional args, or sets `rpcConfig` / `options` / `initialState` on `SodaxWalletProvider`. Triggers on "useXWagmiStore is gone", "SodaxWalletProvider props broke", "old wallet-sdk-react hooks", "upgrade @sodax/wallet-sdk-react".
---

# When to use this skill

Pick this skill if the consumer has v1 wallet-sdk-react patterns. Grep signals:

```bash
grep -rE 'useXWagmiStore|rpcConfig|initialState' src/
grep -rE 'SodaxWalletProvider.*(options|rpcConfig|initialState)' src/
```

The package name **did not change** between v1 and v2 — both versions publish as `@sodax/wallet-sdk-react`. Migration is detected by import surface, not by package name.

If a project has both v1 patterns AND a request for new features: **migration first, then integration**.

# Workflow

1. Read [`../../knowledge/wallet-sdk-react/migration/ai-rules.md`](../../knowledge/wallet-sdk-react/migration/ai-rules.md) — DO / DON'T + workflow + stop conditions.
2. Read [`../../knowledge/wallet-sdk-react/migration/breaking-changes.md`](../../knowledge/wallet-sdk-react/migration/breaking-changes.md) — full narrative of every v1 → v2 change.
3. Apply per-task recipes from [`../../knowledge/wallet-sdk-react/migration/recipes/`](../../knowledge/wallet-sdk-react/migration/recipes/) — `connect-button.md`, `multi-chain-modal.md`, `ssr-setup.md`, `walletconnect-migration.md`.
4. Use [`reference/`](../../knowledge/wallet-sdk-react/migration/reference/) lookups when symbols don't match — `imports.md`, `hooks.md`, `config.md`, `components.md`.
5. Verify with [`checklist.md`](../../knowledge/wallet-sdk-react/migration/checklist.md).

# Top mechanical changes

1. **`useXWagmiStore` removed from the public API.** v2 does **not** export the store hook at all — neither `useXWagmiStore` nor `useXWalletStore` is available from the package barrel. Replace each `useXWagmiStore(state => state.X)` selector with the matching public hook (`useXServices`, `useXService({ xChainType })`, `useXConnections`, `useXConnection({ xChainType })`, etc.). See [`../../knowledge/wallet-sdk-react/migration/reference/imports.md`](../../knowledge/wallet-sdk-react/migration/reference/imports.md) § "Store hook removed from the public API" for the full field-to-hook map and a STOP decision tree for selectors hitting v2-internal fields. The localStorage persistence key `'xwagmi-store'` is unchanged, so user connections survive the upgrade.
2. **Hook args unified to a single object.** v1 hooks took positional args; v2 hooks take `{ xChainType }` or `{ xChainId }` (mutually exclusive on `useXAccount` / `useWalletProvider`).
3. **`SodaxWalletProvider` props.** v1's `rpcConfig`, `options`, `initialState` props are removed. v2 takes one `config: SodaxWalletConfig` prop where top-level keys are `ChainType` slots (`EVM`, `SOLANA`, `SUI`, …). The old `chains: { EVM, SOLANA, ... }` wrapper is also gone — chain-type slots are now top-level.
4. **Per-chain entry shape varies.** EVM/SOLANA/SUI/ICON/NEAR use `{ rpcUrl?, defaults? }`; BITCOIN/STELLAR/INJECTIVE extend their `*RpcConfig` with `{ defaults? }`; STACKS accepts a preset name or `StacksNetworkLike & { defaults? }`.

# Stop conditions (defer to user)

| Signal | Why stop |
|---|---|
| User wants a chain family not in `integration/reference/chain-support.md` | Adding a new chain is a maintainer task. |
| User has a custom `XService` / `XConnector` subclass with non-trivial logic | Custom subclasses are a maintainer-only path. Confirm scope first. |
| User mixes v1 and v2 patterns in new code being written | Do migration first, then integration. |

# DO

- Replace every `useXWagmiStore(state => state.X)` selector with the matching v2 public hook (`useXServices`, `useXService({ xChainType })`, `useXConnections`, `useXConnection({ xChainType })`, …) — drop the `useXWagmiStore` import entirely. See `../../knowledge/wallet-sdk-react/migration/reference/imports.md` § "Store hook removed" for the field-to-hook map.
- Reshape `SodaxWalletProvider` props to the single `config` object.
- Move RPC config from old `rpcConfig` prop to per-chain `{ rpcUrl }` under the relevant slot.
- For EVM-only WalletConnect setup (Fireblocks etc.), add `walletConnect: { projectId: '…' }` to the EVM slot — see `recipes/walletconnect-migration.md`.

# DO NOT

- **Rename `useXWagmiStore` to `useXWalletStore`.** The v2 barrel does not export either name. The store implementation file is named `useXWalletStore.ts` internally, but the hook is private — every consumer call site must move to a public hook.
- Keep destructuring positional args from hooks — every v2 hook takes one object.
- Use `rpcConfig` / `options` / `initialState` props on `SodaxWalletProvider` — they're gone.
- Pass both `xChainId` and `xChainType` to `useXAccount` / `useWalletProvider` — mutually exclusive.
- Forget about persist hydration. `useConnectedChains().status === 'ready'` gates UI; render too early and you get flicker.

# Verification

```bash
pnpm tsc --noEmit                                      # must exit clean
grep -rE 'useXWagmiStore|useXWalletStore' src/         # empty — v2 exports neither
grep -rE 'SodaxWalletProvider.*(rpcConfig|initialState)' src/   # empty
```

Manual: connections still survive page reload (localStorage key `xwagmi-store` was preserved for backward compat).

# Related skills

- `sodax-wallet-sdk-react-integration` — write new code (use after migration completes).
- `sodax-dapp-kit-migration` — if the consumer also uses React hooks wrapping the SDK.
- `sodax-sdk-migration` — the SDK-level v1 → v2 work that often runs alongside this one.
