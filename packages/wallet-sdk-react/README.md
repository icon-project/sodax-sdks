# @sodax/wallet-sdk-react

A comprehensive React Wallet SDK tailored for the Sodax ecosystem that provides unified wallet connectivity across multiple blockchain networks.

## Features
- Seamless wallet connectivity for all supported wallets in the Sodax network
  - EVM Wallets: All browser extensions that support [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) (Hana Wallet, MetaMask, Phantom, etc.) ✅
  - Sui Wallets: All browser extension that @mysten/dapp-kit supports (Hana, Sui Wallet, Suiet, etc.) ✅
  - Solana Wallets: ✅
  - Stellar Wallets: ✅
  - Injective Wallets: ✅
  - ICON Wallets: ✅ (Hana Wallet and other ICON-compatible extensions)

- Address and connection state management
  - EVM (Arbitrum, Avalanche, Base, BSC, Optimism, Polygon, Sonic, HyperEVM, LightLink, Ethereum, Redbelly, Kaia) ✅
  - Sui ✅
  - Solana ✅
  - Stellar ✅
  - Injective ✅
  - ICON ✅


## Installation

```bash
# Using npm
npm install @sodax/wallet-sdk-react

# Using yarn
yarn add @sodax/wallet-sdk-react

# Using pnpm
pnpm add @sodax/wallet-sdk-react
```

## Peer Dependencies

This package requires the following peer dependencies:

```json
{
  "react": ">=19",
  "@tanstack/react-query": "5.x"
}
```

## Quick Start

```typescript
import {
  SodaxWalletProvider,
  type SodaxWalletConfig,
  useXAccount,
  useXConnect,
  useXConnectors,
} from '@sodax/wallet-sdk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChainKeys } from '@sodax/types';

// Create a QueryClient instance
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
  // Get available connectors for EVM chain
  const connectors = useXConnectors('EVM');
  
  // Get connect mutation
  const { mutateAsync: connect } = useXConnect();

  // Get connected account info
  const account = useXAccount('EVM');

  return (
    <div className="space-y-4">
      {/* Display connected wallet address if connected */}
      {account?.address && (
        <div className="p-4 bg-gray-100 rounded-lg">
          <p className="text-sm text-gray-600">Connected Wallet:</p>
          <p className="font-mono">{account.address}</p>
        </div>
      )}

      {/* Display available connectors */}
      <div className="space-y-2">
        {connectors.map((connector) => (
          <button
            key={connector.id}
            onClick={() => connect(connector)}
            className="flex items-center gap-2 p-2 border rounded-lg hover:bg-gray-50"
          >
            <img 
              src={connector.icon} 
              alt={connector.name} 
              width={24} 
              height={24} 
              className="rounded-md" 
            />
            <span>Connect {connector.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

This example demonstrates:
1. Setting up the required providers (`QueryClientProvider` and `SodaxWalletProvider`)
2. Using `useXConnectors` to get available wallet connectors
3. Using `useXConnect` to handle wallet connections
4. Using `useXAccount` to display the connected wallet address
5. A basic UI to display and connect to available wallets


## Requirements

- Node.js >= 18.0.0
- React >= 19
- TypeScript


## API Reference

### Components

- [`SodaxWalletProvider`](src/SodaxWalletProvider.tsx) - Main provider component for wallet connectivity

### Hooks

#### Core Wallet Hooks
- [`useXConnectors`](src/hooks/useXConnectors.ts) - Get available wallet connectors
- [`useXConnectorsByChain`](src/hooks/useXConnectorsByChain.ts) - Get connectors for all enabled chain types
- [`useXConnect`](src/hooks/useXConnect.ts) - Connect to a wallet
- [`useXAccount`](src/hooks/useXAccount.ts) - Get account information
- [`useXDisconnect`](src/hooks/useXDisconnect.ts) - Disconnect from a wallet
- [`useXConnection`](src/hooks/useXConnection.ts) - Read the active connection for a chain type
- [`useXConnections`](src/hooks/useXConnections.ts) - Read all active connections
- [`useXAccounts`](src/hooks/useXAccounts.ts) - Read all connected accounts

#### Chain-Specific Hooks
- [`useEvmSwitchChain`](src/hooks/useEvmSwitchChain.ts) - Switch between EVM chains

#### Signing Hooks
- [`useXSignMessage`](src/hooks/useXSignMessage.ts) - Cross-chain message signing

#### Config / Feature Hooks
- [`useEnabledChains`](src/hooks/useEnabledChains.ts) - Read enabled chain types from provider config

#### Service Hooks
- [`useXService`](src/hooks/useXService.ts) - Access chain-specific service
- [`useXServices`](src/hooks/useXServices.ts) - Access all chain services for enabled chain types
- [`useWalletProvider`](src/hooks/useWalletProvider.ts) - Get a typed wallet provider for a spoke chain id (bridge to `@sodax/wallet-sdk-core`)

#### Modal Flow Hooks
- [`useWalletModal`](src/hooks/useWalletModal.ts) - Headless modal state machine (chainSelect → walletSelect → connecting → success | error)
- [`useConnectionFlow`](src/hooks/useConnectionFlow.ts) - Standalone connect with status + retry (no modal)

#### Batch Hooks
- [`useBatchConnect`](src/hooks/useBatchConnect.ts) - Sequential multi-chain connect by wallet identifier
- [`useBatchDisconnect`](src/hooks/useBatchDisconnect.ts) - Sequential multi-chain disconnect

#### Aggregate / Detection Hooks
- [`useChainGroups`](src/hooks/useChainGroups.ts) - One entry per enabled chain type (EVM collapses to one group)
- [`useConnectedChains`](src/hooks/useConnectedChains.ts) - Aggregate view of connected chains + hydration status
- [`useIsWalletInstalled`](src/hooks/useIsWalletInstalled.ts) - Cross-chain wallet install detection

### Utilities
- [`sortConnectors`](src/utils/sortConnectors.ts) - Preferred first, then installed, then original order
- [`isNativeToken`](src/utils/index.ts) - Checks if an `XToken` is native for its chain
- [`getRpcUrl`](src/utils/walletRpcConfig.ts) - Resolve the per-chain RPC URL from `SodaxWalletConfig`

### Types

#### Core Types
- [`SodaxWalletConfig`](src/types/config.ts) - Provider config type for enabled chain types + per-chain RPC/defaults
- [`IXConnector`](src/types/interfaces.ts) - Public connector interface (what hooks consume)
- [`IXService`](src/types/interfaces.ts) - Public service interface (what hooks return)
- [`XAccount`](src/types/index.ts) - Wallet account type
- [`XConnection`](src/types/index.ts) - Wallet connection type
- [`BatchOperationStatus`](src/types/batchStatus.ts) - Batch connect/disconnect status union

### Classes

Concrete connector/service classes are available via deep imports (sub-path exports):

```ts
import { InjectiveXConnector } from '@sodax/wallet-sdk-react/xchains/injective';
```

- Base abstract class: [`XConnector`](src/core/XConnector.ts)
- Example deep exports:
  - Injective: `@sodax/wallet-sdk-react/xchains/injective` → [`InjectiveXConnector`](src/xchains/injective/InjectiveXConnector.ts)
  - ICON: `@sodax/wallet-sdk-react/xchains/icon` → [`IconHanaXConnector`](src/xchains/icon/IconHanaXConnector.ts)

## Contributing

We welcome contributions! Please see the repo [Contributing Guide](../../CONTRIBUTING.md) for details.

## Development

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build      

# Run in development mode
pnpm dev

# Run type checking
pnpm checkTs

# Format code
pnpm pretty

# Lint code
pnpm lint
```

## License

[MIT](LICENSE)

## Support

- [GitHub Issues](https://github.com/icon-project/sodax-frontend/issues)
- [Discord Community](https://discord.gg/sodax-formerly-icon-880651922682560582)
