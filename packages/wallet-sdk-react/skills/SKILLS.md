# @sodax/wallet-sdk-react Skills

Scaffolding guides that let you wire SODAX wallet connectivity into a React app in one prompt. Built for and tested with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — point it at a skill file and it generates the correct providers, hooks, and types.

## Quick Start

Skills ship with the npm package. After installing `@sodax/wallet-sdk-react`:

**1. Set up providers** (do this first)

> Read `node_modules/@sodax/wallet-sdk-react/skills/setup.md` and wire `SodaxWalletProvider` into my app.

**2. Pick a connect UX**

> Read `node_modules/@sodax/wallet-sdk-react/skills/connect-button.md` and add a single-chain connect button.

> Read `node_modules/@sodax/wallet-sdk-react/skills/multi-chain-modal.md` and add a multi-chain wallet modal.

**3. Add advanced features as needed**

> Read `node_modules/@sodax/wallet-sdk-react/skills/evm-only-walletconnect.md` and enable WalletConnect for enterprise custody (Fireblocks, etc.).

> Read `node_modules/@sodax/wallet-sdk-react/skills/bridge-to-sdk.md` and pass the connected wallet provider to a `@sodax/sdk` swap call.

The pattern is always: `Read node_modules/@sodax/wallet-sdk-react/skills/<skill>.md` + what you want to build.

### Tips

- One skill per prompt gets better results than asking for everything at once.
- Always do setup before any other skill.
- Pair `connect-button.md` (one chain at a time) OR `multi-chain-modal.md` (chain picker + connector picker) — they're alternatives, not additive.

---

*Internal devs working in this monorepo: use `skills/<skill>.md` instead of the `node_modules` path, and reference sibling docs in `docs/` for the underlying API.*

## Dependency Graph

```
setup
  ├── connect-button         (single-chain connect/disconnect)
  ├── multi-chain-modal      (modal-driven multi-chain UX)
  ├── evm-only-walletconnect (Fireblocks / custody opt-in)
  └── bridge-to-sdk          (pass walletProvider to @sodax/sdk calls)
```

## Skill Index

| Skill | File | Description | Depends On |
|-------|------|-------------|------------|
| Setup | [setup.md](setup.md) | Install + wire `SodaxWalletProvider` with chain-type slots | None |
| Connect Button | [connect-button.md](connect-button.md) | `useXConnectors` + `useXConnect` + `useXDisconnect` for one chain | `setup` |
| Multi-chain Modal | [multi-chain-modal.md](multi-chain-modal.md) | `useWalletModal` headless state machine + `useChainGroups` | `setup` |
| EVM-only WalletConnect | [evm-only-walletconnect.md](evm-only-walletconnect.md) | Enable WalletConnect for Fireblocks / Ledger / mobile-only wallets | `setup` |
| Bridge to SDK | [bridge-to-sdk.md](bridge-to-sdk.md) | `useWalletProvider` → typed `IXxxWalletProvider` for `@sodax/sdk` calls | `setup`, one of `connect-button` / `multi-chain-modal` |

## Conventions

### Single object parameter

Every hook in `@sodax/wallet-sdk-react` accepts one options object:

```typescript
useXConnectors({ xChainType: 'EVM' });
useXAccount({ xChainId: ChainKeys.BSC_MAINNET });
useWalletProvider({ xChainType: 'EVM' });
```

`useXAccount` / `useWalletProvider` accept either `xChainId` (chain key) **or** `xChainType` (family) — never both.

### Mutation pattern (`useXConnect`)

`useXConnect` is a React Query mutation. Pass an `IXConnector` to `mutate` / `mutateAsync`:

```typescript
const { mutateAsync: connect } = useXConnect();
await connect(connector);
```

For provider-managed chains (EVM/Solana/Sui), the resolved value is `undefined` — read the connected account via `useXAccount` after the mutation lands. See [Connect Flow caveat](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md#provider-managed-chains-caveat).

### Persisted connections

Connections survive page reloads via `localStorage` (key `xwagmi-store`). Gate UI on hydration to avoid flicker — `useConnectedChains().status === 'ready'` is the official signal.
