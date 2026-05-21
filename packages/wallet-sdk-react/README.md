# @sodax/wallet-sdk-react

React layer over [`@sodax/wallet-sdk-core`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-core/README.md) — wallet connection, signing, and account management for the SODAX cross-chain ecosystem. Hooks read from a single Zustand store; per-chain native SDKs (wagmi, `@solana/wallet-adapter`, `@mysten/dapp-kit`, …) are wrapped behind a uniform `IXService` / `IXConnector` interface.

## Features

- **Unified wallet connectivity** for 9 chain families across 20 chains
  - EVM (Sonic hub, Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia) — EIP-6963 + WalletConnect
  - Solana, Sui, Stellar, ICON, Injective, Bitcoin, NEAR, Stacks
- **Single-store state** — `useXAccount`, `useXConnection`, `useXAccounts` all read the same Zustand slice; persisted to `localStorage`
- **Bridge to `@sodax/sdk`** — `useWalletProvider` returns a typed `IXxxWalletProvider` ready to plug into any SDK call
- **Headless wallet modal** — `useWalletModal` state machine (chainSelect → walletSelect → connecting → success | error), render-agnostic
- **Batch operations** — connect/disconnect every chain a wallet identifier covers, in sequence
- **WalletConnect** — opt-in for enterprise custody (Fireblocks, etc.) via `config.EVM.walletConnect`

## Installation

```bash
pnpm add @sodax/wallet-sdk-react
# or
npm install @sodax/wallet-sdk-react
# or
yarn add @sodax/wallet-sdk-react
```

## Peer dependencies

```json
{
  "react": ">=19",
  "@tanstack/react-query": "5.x"
}
```

## Quick start

```tsx
import {
  SodaxWalletProvider,
  type SodaxWalletConfig,
  useXAccount,
  useXConnect,
  useXConnectors,
} from '@sodax/wallet-sdk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChainKeys } from '@sodax/types';

const queryClient = new QueryClient();

const config: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
    },
    // Optional: add WalletConnect support (requires wc projectId)
    // walletConnect: { projectId: '...' },
  },
  ICON: {
    chains: {
      [ChainKeys.ICON_MAINNET]: { rpcUrl: 'https://ctz.solidwallet.io/api/v3' },
    },
  },
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={config}>
        <WalletConnect />
      </SodaxWalletProvider>
    </QueryClientProvider>
  );
}

function WalletConnect() {
  const connectors = useXConnectors({ xChainType: 'EVM' });
  const { mutateAsync: connect } = useXConnect();
  const account = useXAccount({ xChainType: 'EVM' });

  if (account.address) {
    return <p>Connected: {account.address}</p>;
  }

  return (
    <div>
      {connectors.map(connector => (
        <button key={connector.id} onClick={() => connect(connector)}>
          {connector.icon && <img src={connector.icon} alt="" width={20} height={20} />}
          {connector.name}
        </button>
      ))}
    </div>
  );
}
```

## Documentation

The full guide lives in [`docs/`](docs/). Start with the topic that matches what you're building.

| Topic | What it covers |
|-------|----------------|
| [Configure SodaxWalletProvider](docs/CONFIGURE_PROVIDER.md) | `SodaxWalletConfig` shape, opt-in chain mounting, per-chain RPC + wallet defaults, breaking changes from v1 |
| [Connect Flow](docs/CONNECT_FLOW.md) | Discover connectors, connect, read account, disconnect; provider-managed vs non-provider chains; persisted reconnect |
| [Wallet Provider Bridge](docs/WALLET_PROVIDER_BRIDGE.md) | `useWalletProvider` → typed `IXxxWalletProvider` for `@sodax/sdk` calls; `useXService` / `useXServices` |
| [Wallet Modal](docs/WALLET_MODAL.md) | Headless state machine for multi-chain modal UIs; `useConnectionFlow` non-modal alternative |
| [WalletConnect](docs/WALLETCONNECT.md) | Enterprise custody integration (Fireblocks, Ledger); `qrModalOptions` filtering |
| [Batch Operations](docs/BATCH_OPERATIONS.md) | Sequential multi-chain connect/disconnect by wallet identifier |
| [Chain Detection](docs/CHAIN_DETECTION.md) | `useChainGroups`, `useConnectedChains`, `useIsWalletInstalled`, `useEnabledChains`; hydration status |
| [Sign Message](docs/SIGN_MESSAGE.md) | `useXSignMessage` cross-chain; Bitcoin BIP-322 vs ECDSA auto-detect |
| [EVM Switch Chain](docs/EVM_SWITCH_CHAIN.md) | Single wagmi connection across all configured EVM networks |
| [Connectors](docs/CONNECTORS.md) | `IXConnector` contract, deep-import concrete classes, custom connectors |
| [Architecture](docs/ARCHITECTURE.md) | Zustand store, Provider/Hydrator/Actions trio, persist hydration caveat |
| [Adding a New Chain](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ADDING_A_NEW_CHAIN.md) | `ChainMeta` extension, chain registry, sub-path export wiring |

## AI agent docs

AI-readable docs for `@sodax/wallet-sdk-react` (and the other `@sodax/*` packages) are shipped via [`@sodax/skills`](https://github.com/icon-project/sodax-sdks/tree/main/packages/skills) — a separate npm package bundling Claude-Code SKILL.md files and a long-form knowledge tree.

**Recommended: [`skills` CLI](https://github.com/vercel-labs/skills)** — from your project root:

```bash
npx skills@latest add icon-project/sodax-sdks/packages/skills
```

**npm + `AGENTS.md` pointer** (fallback for web chats, or when you prefer a devDependency over the CLI):

```bash
pnpm add -D @sodax/skills
```

Then point your agent at `node_modules/@sodax/skills/AGENTS.md`. See [docs/ai-integration-guide.md](https://github.com/icon-project/sodax-sdks/blob/main/docs/ai-integration-guide.md) for all install modes and per-tool wiring.

---

## Sub-path exports

Concrete connector / service classes are **not** exported from the package barrel — they live behind sub-path imports to prevent accidental coupling to internals:

```typescript
// ✅ Normal usage — barrel import
import { useXConnect, useXAccount, type IXConnector } from '@sodax/wallet-sdk-react';

// ✅ Advanced — concrete class via deep import
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';
import { AleoXConnector } from '@sodax/wallet-sdk-react/xchains/aleo';
if (connector instanceof XverseXConnector) {
  connector.setAddressPurpose('payment');
}
```

See [Connectors](docs/CONNECTORS.md) for the full list of deep-import sub-paths.

## Requirements

- Node.js >= 20.12.0
- React >= 19
- TypeScript

## Development

```bash
pnpm install     # Install dependencies
pnpm build       # Build the package (ESM + CJS, multi-entry)
pnpm dev         # Watch mode
pnpm checkTs     # Type checking
pnpm test        # Run tests
pnpm pretty      # Format code
pnpm lint        # Lint code
```

## Contributing

Contributions welcome — see the repo [Contributing Guide](https://github.com/icon-project/sodax-sdks/blob/main/CONTRIBUTING.md). For onboarding a new chain family, follow [`docs/ADDING_A_NEW_CHAIN.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ADDING_A_NEW_CHAIN.md).

## License

[MIT](LICENSE)

## Support

- [GitHub Issues](https://github.com/icon-project/sodax-sdks/issues)
- [Discord Community](https://discord.gg/sodax-formerly-icon-880651922682560582)
