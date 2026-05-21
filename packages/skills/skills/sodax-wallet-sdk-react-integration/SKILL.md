---
name: sodax-wallet-sdk-react-integration
description: 'Build NEW code with `@sodax/wallet-sdk-react` — the React wallet connectivity layer for multi-chain dapps. Covers `SodaxWalletProvider` setup, hook-based connect/disconnect/account/signing UX across 9 chain types (EVM, Solana, Sui, Bitcoin, Stellar, ICON, Injective, NEAR, Stacks), headless wallet-modal primitives, WalletConnect for non-injected wallets (Fireblocks/Ledger/mobile), and `useWalletProvider` for bridging the connected wallet into `@sodax/sdk` calls. Use whenever a React dapp needs SODAX wallet connection. Triggers on "add wallet connect", "set up SodaxWalletProvider", "useXConnect", "useXAccount", "useWalletProvider", "useWalletModal", "wallet modal", "connect button", "multi-chain wallet UI", "WalletConnect for Fireblocks". Peer deps: `react >= 19`, `@tanstack/react-query 5.x`.'
---

# When to use this skill

Pick this skill when the consumer is a React dapp that needs SODAX wallet connectivity. Common signals:

- "I need a wallet connect button" — `useXConnect`, `useXAccount`.
- "Multi-chain modal UI" — `useWalletModal`, `useChainGroups`, `useConnectedChains`.
- "Pass the connected wallet to a `@sodax/sdk` swap" — `useWalletProvider({ xChainId })`.
- "Add WalletConnect for enterprise custody (Fireblocks, mobile)" — `walletConnect` field on `SodaxWalletConfig.EVM`.
- "SSR with Next.js" — `ssr: true` flag on the EVM slot.

For backend / non-React → use `sodax-wallet-sdk-core-integration` instead.

For React dapps with hooks wrapping the SDK → also load `sodax-dapp-kit-integration`.

For porting v1 wallet-sdk-react code → use `sodax-wallet-sdk-react-migration` first.

# Workflow

1. Read [`../../knowledge/wallet-sdk-react/integration/ai-rules.md`](../../knowledge/wallet-sdk-react/integration/ai-rules.md) — DO / DON'T + workflow.
2. **Always start with setup** → [`../../knowledge/wallet-sdk-react/integration/recipes/setup.md`](../../knowledge/wallet-sdk-react/integration/recipes/setup.md). Mount `SodaxWalletProvider`, declare chain-type slots, wire `@tanstack/react-query`.
3. Read [`../../knowledge/wallet-sdk-react/integration/architecture.md`](../../knowledge/wallet-sdk-react/integration/architecture.md) — provider mount tree, frozen config, EVM single-connection model, `xChainType` vs `xChainId`.
4. Task-specific recipes → [`../../knowledge/wallet-sdk-react/integration/recipes/`](../../knowledge/wallet-sdk-react/integration/recipes/) — `connect-button.md`, `multi-chain-modal.md`, `walletconnect-setup.md`, `bridge-to-sdk.md`, `sign-message.md`, `switch-chain.md`, `batch-operations.md`, `chain-detection.md`, `sub-path-imports.md`.
5. Working examples → [`../../knowledge/wallet-sdk-react/integration/examples/`](../../knowledge/wallet-sdk-react/integration/examples/) — 4 working `.tsx` app shells (`01-minimal-evm`, `02-multi-chain-modal`, `03-nextjs-app-router`, `04-walletconnect-setup`).
6. Lookups → [`../../knowledge/wallet-sdk-react/integration/reference/`](../../knowledge/wallet-sdk-react/integration/reference/) — hooks, connectors, chain-support, wallet-brands, api-surface.

# Conventions to follow

- **Single object parameter on every hook.** `useXConnectors({ xChainType: 'EVM' })`, `useXAccount({ xChainId: ChainKeys.BSC_MAINNET })`, `useWalletProvider({ xChainType: 'EVM' })`. `useXAccount` and `useWalletProvider` take **either** `xChainId` (chain key) **or** `xChainType` (family) — never both.
- **`useXConnect` is a React Query mutation.** Pass an `IXConnector` to `mutate` / `mutateAsync`. For provider-managed chains (EVM/Solana/Sui), the resolved value is `undefined` — read the connected account via `useXAccount` after the mutation lands.
- **Persisted connections.** Connections survive page reloads via `localStorage` (key `xwagmi-store`). Gate UI on hydration with `useConnectedChains().status === 'ready'` to avoid flicker.
- **EVM is one connection across all networks.** wagmi covers every configured EVM network under one connector — `useChainGroups` / `useConnectedChains` report a single `EVM` row.
- **Configurable chain opt-in.** `SodaxWalletProvider config` accepts a `SodaxWalletConfig` where top-level keys are `ChainType` slots (`EVM`, `SOLANA`, `SUI`, `BITCOIN`, `STELLAR`, `INJECTIVE`, `ICON`, `NEAR`, `STACKS`). Omit a slot to skip mounting that adapter; pass `{}` to mount with SDK defaults.
- **Don't import concrete chain classes from the barrel.** `EvmXService`, `XverseXConnector`, etc. are **deep-import only** (`@sodax/wallet-sdk-react/xchains/<chain>`). The barrel only exports hooks, types, interfaces, and `SodaxWalletProvider`.

# Wallet modal primitives

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

# Top traps to avoid

1. **Passing both `xChainId` and `xChainType`** to `useXAccount` / `useWalletProvider`. They're mutually exclusive.
2. **Casting the return value of `useWalletProvider`.** Use the chain-key narrowing pattern (passing a specific `xChainId`) to get the typed `IXxxWalletProvider` without `as`.
3. **Importing concrete classes from the barrel.** `EvmXService`, `XverseXConnector`, etc. live behind `@sodax/wallet-sdk-react/xchains/<chain>` deep imports.
4. **Ignoring the persist-hydration gate.** Render UI before `useConnectedChains().status === 'ready'` and you get a flicker / stale-state.
5. **Forgetting WalletConnect setup for enterprise custody.** Default EVM discovery is EIP-6963 (browser extensions only). Fireblocks / Ledger / mobile-only wallets need the `walletConnect` field on the `EVM` slot.

# Verification

```bash
pnpm tsc --noEmit   # must exit clean
```

Manually verify in browser:
- Connect / disconnect flows work for at least one wallet per enabled chain.
- Page reload preserves the connection (until `useXDisconnect`).
- `useWalletProvider({ xChainId: ChainKeys.X })` returns the chain-narrowed `IXxxWalletProvider`, ready to pass into `@sodax/sdk` calls (with `raw: false`).

# Related skills

- `sodax-wallet-sdk-react-migration` — port v1 wallet-sdk-react code (deleted `useXWagmiStore`, removed `rpcConfig`/`options`/`initialState` props, etc.).
- `sodax-dapp-kit-integration` — React hooks wrapping `@sodax/sdk`. Use `useWalletProvider` to bridge.
- `sodax-sdk-integration` — for any direct SDK call from the React app.
