# Skill: Setup

Install and wire `@sodax/wallet-sdk-react` into a React project.

**Depends on:** None

## Install

```bash
pnpm add @sodax/wallet-sdk-react @tanstack/react-query
```

Peer dependencies:

```json
{
  "react": ">=19",
  "@tanstack/react-query": "5.x"
}
```

## Wire `SodaxWalletProvider`

Top-level keys on `SodaxWalletConfig` are chain-type slots — **omit a slot to skip mounting that adapter**, pass `{}` to mount with SDK defaults. `<QueryClientProvider>` must wrap `<SodaxWalletProvider>`.

```tsx
// providers.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

const queryClient = new QueryClient();

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true, // Next.js — keep true for SSR-safe hydration
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
      [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    },
  },
  ICON: {
    chains: { [ChainKeys.ICON_MAINNET]: { rpcUrl: 'https://ctz.solidwallet.io/api/v3' } },
  },
  // BITCOIN: {},  // mount with SDK defaults
  // SOLANA: { chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: '...' } } },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
    </QueryClientProvider>
  );
}
```

Use `Providers` at the app root (e.g. `app/layout.tsx` for Next.js, `main.tsx` for Vite).

## Chain-type slots

| Slot | Mounts | When to include |
|------|--------|-----------------|
| `EVM` | wagmi (12 EVM chains) | Sonic, Ethereum, Arbitrum, Base, BSC, etc. |
| `SOLANA` | `@solana/wallet-adapter-react` | Solana support |
| `SUI` | `@mysten/dapp-kit` | Sui support |
| `BITCOIN` | (no React adapter) | Bitcoin support |
| `STELLAR` | (no React adapter) | Stellar support |
| `ICON` | (no React adapter) | ICON support |
| `INJECTIVE` | (no React adapter) | Injective support |
| `NEAR` | (no React adapter) | NEAR support |
| `STACKS` | (no React adapter) | Stacks support |

## Config is captured once on mount

`SodaxWalletProvider` freezes the `config` prop on first render. Subsequent re-renders with a new reference have **no effect**. To swap config at runtime, remount with a new `key`:

```tsx
<SodaxWalletProvider key={configVersion} config={walletConfig}>
  {children}
</SodaxWalletProvider>
```

## Pair with `@sodax/dapp-kit` (optional)

If you also use `@sodax/dapp-kit` for SDK feature hooks, mount `SodaxProvider` outermost:

```tsx
<SodaxProvider config={sodaxConfig}>
  <QueryClientProvider client={queryClient}>
    <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
  </QueryClientProvider>
</SodaxProvider>
```

See [`packages/dapp-kit/skills/setup.md`](https://github.com/icon-project/sodax-frontend/blob/main/packages/dapp-kit/skills/setup.md) for the dapp-kit side.

## Next steps

- [`connect-button.md`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/skills/connect-button.md) — single-chain connect/disconnect button
- [`multi-chain-modal.md`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/skills/multi-chain-modal.md) — multi-chain headless wallet modal
- [`bridge-to-sdk.md`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/skills/bridge-to-sdk.md) — pass `walletProvider` to `@sodax/sdk` calls

## Reference docs

- [Configure SodaxWalletProvider](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONFIGURE_PROVIDER.md) — full config reference, breaking changes from v1, per-chain `defaults`
