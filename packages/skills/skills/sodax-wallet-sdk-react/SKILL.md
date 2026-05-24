---
name: sodax-wallet-sdk-react
description: 'INTEGRATION (write NEW code) — @sodax/wallet-sdk-react is the React wallet connectivity layer for multi-chain dapps. Covers `SodaxWalletProvider` setup, hook-based connect/disconnect/account/signing UX across 9 chain types (EVM, Solana, Sui, Bitcoin, Stellar, ICON, Injective, NEAR, Stacks), headless wallet-modal primitives, WalletConnect for non-injected wallets (Fireblocks/Ledger/mobile), and `useWalletProvider` for bridging the connected wallet into `@sodax/sdk` calls. Use whenever a React dapp needs SODAX wallet connectivity. Triggers on "add wallet connect", "set up SodaxWalletProvider", "useXConnect", "useXAccount", "useWalletProvider", "useWalletModal", "wallet modal", "connect button", "multi-chain wallet UI", "WalletConnect for Fireblocks". Peer deps: `react >= 19`, `@tanstack/react-query 5.x`. MIGRATION (port v1 → v2) — the v2 reshape removed `useXWagmiStore` from the public API (each selector must be replaced with a public hook like `useXServices` / `useXService({ xChainType })` / `useXConnections` / `useXConnection({ xChainType })`; do NOT rename to `useXWalletStore` — the v2 barrel does not export it), unified hook signatures to single-object params, reshaped `SodaxWalletProvider` props (removed `rpcConfig` / `options` / `initialState` in favor of `config: SodaxWalletConfig`), and flattened the chain-slot wrapper (`chains: { EVM, SOLANA, ... }` → top-level slots on `SodaxWalletConfig`). Triggers on "useXWagmiStore is gone", "SodaxWalletProvider props broke", "old wallet-sdk-react hooks", "upgrade @sodax/wallet-sdk-react". Load this skill if EITHER applies; the body gates by mode.'
---

# When to use this skill

AGENTS.md routes you here when you're working with `@sodax/wallet-sdk-react` v2 — either writing new code or porting from v1.

**Pick your mode:**

- Writing NEW v2 code (greenfield, no v1 imports)? → § **Integration mode** below.
- Porting EXISTING v1 code to v2 (grep finds `useXWagmiStore`, `rpcConfig`, `initialState`, or positional-args hooks)? → § **Migration mode** below.
- Both? → migration first, then integration.

For backend / non-React → use `sodax-wallet-sdk-core` instead.
For React dapps with hooks wrapping the SDK → also load `sodax-dapp-kit`.

---

## Integration mode (writing new v2 code)

Pick this mode when the consumer is a React dapp that needs SODAX wallet connectivity. Common signals:

- "I need a wallet connect button" — `useXConnect`, `useXAccount`.
- "Multi-chain modal UI" — `useWalletModal`, `useChainGroups`, `useConnectedChains`.
- "Pass the connected wallet to a `@sodax/sdk` swap" — `useWalletProvider({ xChainId })`.
- "Add WalletConnect for enterprise custody (Fireblocks, mobile)" — `walletConnect` field on `SodaxWalletConfig.EVM`.
- "SSR with Next.js" — `ssr: true` flag on the EVM slot.

### Workflow

1. Read [`integration/knowledge/ai-rules.md`](./integration/knowledge/ai-rules.md) — DO / DON'T + workflow.
2. **Always start with setup** → [`integration/knowledge/recipes/setup.md`](./integration/knowledge/recipes/setup.md). Mount `SodaxWalletProvider`, declare chain-type slots, wire `@tanstack/react-query`.
3. Read [`integration/knowledge/architecture.md`](./integration/knowledge/architecture.md) — provider mount tree, frozen config, EVM single-connection model, `xChainType` vs `xChainId`.
4. Task-specific recipes → [`integration/knowledge/recipes/`](./integration/knowledge/recipes/) — `connect-button.md`, `multi-chain-modal.md`, `walletconnect-setup.md`, `bridge-to-sdk.md`, `sign-message.md`, `switch-chain.md`, `batch-operations.md`, `chain-detection.md`, `sub-path-imports.md`.
5. Working examples → [`integration/knowledge/examples/`](./integration/knowledge/examples/) — 4 working `.tsx` app shells (`01-minimal-evm`, `02-multi-chain-modal`, `03-nextjs-app-router`, `04-walletconnect-setup`).
6. Lookups → [`integration/knowledge/reference/`](./integration/knowledge/reference/) — hooks, connectors, chain-support, wallet-brands, api-surface.

### Conventions to follow (integration)

- **Single object parameter on every hook.** `useXConnectors({ xChainType: 'EVM' })`, `useXAccount({ xChainId: ChainKeys.BSC_MAINNET })`, `useWalletProvider({ xChainType: 'EVM' })`. `useXAccount` and `useWalletProvider` take **either** `xChainId` (chain key) **or** `xChainType` (family) — never both.
- **`useXConnect` is a React Query mutation.** Pass an `IXConnector` to `mutate` / `mutateAsync`. For provider-managed chains (EVM/Solana/Sui), the resolved value is `undefined` — read the connected account via `useXAccount` after the mutation lands.
- **Persisted connections.** Connections survive page reloads via `localStorage` (key `xwagmi-store`). Gate UI on hydration with `useConnectedChains().status === 'ready'` to avoid flicker.
- **EVM is one connection across all networks.** wagmi covers every configured EVM network under one connector — `useChainGroups` / `useConnectedChains` report a single `EVM` row.
- **Configurable chain opt-in.** `SodaxWalletProvider config` accepts a `SodaxWalletConfig` where top-level keys are `ChainType` slots (`EVM`, `SOLANA`, `SUI`, `BITCOIN`, `STELLAR`, `INJECTIVE`, `ICON`, `NEAR`, `STACKS`). Omit a slot to skip mounting that adapter; pass `{}` to mount with SDK defaults.
- **Don't import concrete chain classes from the barrel.** `EvmXService`, `XverseXConnector`, etc. are **deep-import only** (`@sodax/wallet-sdk-react/xchains/<chain>`). The barrel only exports hooks, types, interfaces, and `SodaxWalletProvider`.

### Wallet modal primitives

Headless building blocks (render-agnostic, wallet-agnostic):

| Hook | Purpose |
|---|---|
| `useWalletModal({ onConnected })` | State machine: `closed → chainSelect → walletSelect → connecting → success \| error`. |
| `useConnectionFlow()` | `connect + status + retry` without a modal. |
| `useBatchConnect({ connectors, skipConnected })` | Sequential connect across every chain a wallet identifier covers. |
| `useBatchDisconnect({ connectors? })` | Mirror of `useBatchConnect`; omit `connectors` to disconnect all. |
| `useChainGroups({ order? })` | One entry per enabled chain; EVM collapses to one group. |
| `useConnectedChains({ order? })` | Aggregate connected view; `status: 'loading' \| 'ready'`. |
| `useIsWalletInstalled({ connectors?, chainType? })` | Cross-chain install check; filters AND. |
| `sortConnectors(xs, { preferred })` | Preferred first, then installed, then original. |

Reference app: `apps/wallet-modal-example` in the SODAX monorepo.

### Top traps to avoid (integration)

1. **Passing both `xChainId` and `xChainType`** to `useXAccount` / `useWalletProvider`. They're mutually exclusive.
2. **Casting the return value of `useWalletProvider`.** Use the chain-key narrowing pattern (passing a specific `xChainId`) to get the typed `IXxxWalletProvider` without `as`.
3. **Importing concrete classes from the barrel.** `EvmXService`, `XverseXConnector`, etc. live behind `@sodax/wallet-sdk-react/xchains/<chain>` deep imports.
4. **Ignoring the persist-hydration gate.** Render UI before `useConnectedChains().status === 'ready'` and you get a flicker / stale-state.
5. **Forgetting WalletConnect setup for enterprise custody.** Default EVM discovery is EIP-6963 (browser extensions only). Fireblocks / Ledger / mobile-only wallets need the `walletConnect` field on the `EVM` slot.

### Verification (integration)

```bash
pnpm tsc --noEmit   # must exit clean
```

Manually verify in browser:
- Connect / disconnect flows work for at least one wallet per enabled chain.
- Page reload preserves the connection (until `useXDisconnect`).
- `useWalletProvider({ xChainId: ChainKeys.X })` returns the chain-narrowed `IXxxWalletProvider`, ready to pass into `@sodax/sdk` calls (with `raw: false`).

---

## Migration mode (v1 → v2 porting)

Pick this mode if the consumer has v1 wallet-sdk-react patterns. Grep signals:

```bash
grep -rE 'useXWagmiStore|rpcConfig|initialState' src/
grep -rE 'SodaxWalletProvider.*(options|rpcConfig|initialState)' src/
```

The package name **did not change** between v1 and v2 — both versions publish as `@sodax/wallet-sdk-react`. Migration is detected by import surface, not by package name.

If a project has both v1 patterns AND a request for new features: **migration first, then integration**.

### Workflow

1. Read [`migration-v1-to-v2/knowledge/ai-rules.md`](./migration-v1-to-v2/knowledge/ai-rules.md) — DO / DON'T + workflow + stop conditions.
2. Read [`migration-v1-to-v2/knowledge/breaking-changes.md`](./migration-v1-to-v2/knowledge/breaking-changes.md) — full narrative of every v1 → v2 change.
3. Apply per-task recipes from [`migration-v1-to-v2/knowledge/recipes/`](./migration-v1-to-v2/knowledge/recipes/) — `connect-button.md`, `multi-chain-modal.md`, `ssr-setup.md`, `walletconnect-migration.md`.
4. Use [`reference/`](./migration-v1-to-v2/knowledge/reference/) lookups when symbols don't match — `imports.md`, `hooks.md`, `config.md`, `components.md`.
5. Verify with [`checklist.md`](./migration-v1-to-v2/knowledge/checklist.md).

### Top mechanical changes

1. **`useXWagmiStore` removed from the public API.** v2 does **not** export the store hook at all — neither `useXWagmiStore` nor `useXWalletStore` is available from the package barrel. Replace each `useXWagmiStore(state => state.X)` selector with the matching public hook (`useXServices`, `useXService({ xChainType })`, `useXConnections`, `useXConnection({ xChainType })`, etc.). See [`migration-v1-to-v2/knowledge/reference/imports.md`](./migration-v1-to-v2/knowledge/reference/imports.md) § "Store hook removed from the public API" for the full field-to-hook map and a STOP decision tree for selectors hitting v2-internal fields. The localStorage persistence key `'xwagmi-store'` is unchanged, so user connections survive the upgrade.
2. **Hook args unified to a single object.** v1 hooks took positional args; v2 hooks take `{ xChainType }` or `{ xChainId }` (mutually exclusive on `useXAccount` / `useWalletProvider`).
3. **`SodaxWalletProvider` props.** v1's `rpcConfig`, `options`, `initialState` props are removed. v2 takes one `config: SodaxWalletConfig` prop where top-level keys are `ChainType` slots (`EVM`, `SOLANA`, `SUI`, …). The old `chains: { EVM, SOLANA, ... }` wrapper is also gone — chain-type slots are now top-level.
4. **Per-chain entry shape varies.** EVM/SOLANA/SUI/ICON/NEAR use `{ rpcUrl?, defaults? }`; BITCOIN/STELLAR/INJECTIVE extend their `*RpcConfig` with `{ defaults? }`; STACKS accepts a preset name or `StacksNetworkLike & { defaults? }`.

### Stop conditions (defer to user)

| Signal | Why stop |
|---|---|
| User wants a chain family not in `integration/knowledge/reference/chain-support.md` | Adding a new chain is a maintainer task. |
| User has a custom `XService` / `XConnector` subclass with non-trivial logic | Custom subclasses are a maintainer-only path. Confirm scope first. |
| User mixes v1 and v2 patterns in new code being written | Do migration first, then integration. |

### DO (migration)

- Replace every `useXWagmiStore(state => state.X)` selector with the matching v2 public hook (`useXServices`, `useXService({ xChainType })`, `useXConnections`, `useXConnection({ xChainType })`, …) — drop the `useXWagmiStore` import entirely. See `migration-v1-to-v2/knowledge/reference/imports.md` § "Store hook removed" for the field-to-hook map.
- Reshape `SodaxWalletProvider` props to the single `config` object.
- Move RPC config from old `rpcConfig` prop to per-chain `{ rpcUrl }` under the relevant slot.
- For EVM-only WalletConnect setup (Fireblocks etc.), add `walletConnect: { projectId: '…' }` to the EVM slot — see `recipes/walletconnect-migration.md`.

### DO NOT (migration)

- **Rename `useXWagmiStore` to `useXWalletStore`.** The v2 barrel does not export either name. The store implementation file is named `useXWalletStore.ts` internally, but the hook is private — every consumer call site must move to a public hook.
- Keep destructuring positional args from hooks — every v2 hook takes one object.
- Use `rpcConfig` / `options` / `initialState` props on `SodaxWalletProvider` — they're gone.
- Pass both `xChainId` and `xChainType` to `useXAccount` / `useWalletProvider` — mutually exclusive.
- Forget about persist hydration. `useConnectedChains().status === 'ready'` gates UI; render too early and you get flicker.

### Verification (migration)

```bash
pnpm tsc --noEmit                                      # must exit clean
grep -rE 'useXWagmiStore|useXWalletStore' src/         # empty — v2 exports neither
grep -rE 'SodaxWalletProvider.*(rpcConfig|initialState)' src/   # empty
```

Manual: connections still survive page reload (localStorage key `xwagmi-store` was preserved for backward compat).

---

# Related skills

- `sodax-dapp-kit` — React hooks wrapping `@sodax/sdk`. Use `useWalletProvider` to bridge.
- `sodax-sdk` — for any direct SDK call from the React app (or for the SDK-level v1 → v2 work that often runs alongside this one).
- `sodax-wallet-sdk-core` — the underlying provider classes that `useWalletProvider` returns.
