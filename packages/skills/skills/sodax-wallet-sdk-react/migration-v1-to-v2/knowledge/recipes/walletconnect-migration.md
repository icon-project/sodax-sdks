# Recipe: Adopt WalletConnect (v2 only)

WalletConnect support is **new in v2** — there is no v1 equivalent to migrate from. This recipe is here for users who tried to bolt WalletConnect onto v1 by hand-rolling a wagmi config and now want to use the v2 first-class option.

If you didn't have WalletConnect in v1, **this recipe is opt-in, not required**. Skip if not relevant.

---

## When to use this recipe

Apply when the user's v1 code:

- Built a custom wagmi config that injected `walletConnect()` connector
- Mounted a separate `WagmiProvider` outside `SodaxWalletProvider`
- Patched the v1 internal `createWagmiConfig` helper to include WalletConnect

Or when the user simply wants to **add WalletConnect for the first time** while migrating to v2.

---

## Why apps add WalletConnect

EIP-6963 (the default v2 EVM discovery mechanism) only finds **browser-extension wallets**. Partners using enterprise custody — Fireblocks, Ledger Live, mobile-only wallets — cannot install browser extensions. WalletConnect is the protocol that lets these wallets connect via QR / deep link.

---

## Before (v1, hand-rolled — typical workaround)

```tsx
// @ai-snippets-skip
// v1 ❌ — bypassed the package's wagmi config
import { createConfig, WagmiProvider } from 'wagmi';
import { walletConnect } from 'wagmi/connectors';
import { mainnet, sonic } from 'wagmi/chains';

const wagmiConfig = createConfig({
  chains: [mainnet, sonic],
  connectors: [
    walletConnect({ projectId: 'wc-cloud-project-id' }),
    // ...
  ],
  // ...
});

export function Providers({ children }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      {/* SodaxWalletProvider mounted alongside, with conflicting wagmi state */}
      <SodaxWalletProvider rpcConfig={...} options={...}>
        {children}
      </SodaxWalletProvider>
    </WagmiProvider>
  );
}
```

(This pattern caused two parallel wagmi states and was never officially supported.)

---

## After (v2 — first-class)

```tsx
// v2 ✅
import { ChainKeys } from '@sodax/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    walletConnect: {
      projectId: 'wc-cloud-project-id', // from cloud.walletconnect.com
    },
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
    },
  },
};

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
    </QueryClientProvider>
  );
}
```

The WalletConnect connector is added to wagmi automatically. `useXConnectors({ xChainType: 'EVM' })` will surface it alongside any EIP-6963 wallets.

---

## What changed

| Concern | v1 (hand-rolled) | v2 (first-class) |
|---|---|---|
| WagmiProvider mount | manual, outside SodaxWalletProvider | internal to SodaxWalletProvider |
| wagmi config | hand-built via `createConfig` | derived from `walletConfig` |
| WalletConnect projectId | passed to `walletConnect()` connector | passed to `EVM.walletConnect.projectId` |
| Two parallel wagmi states | yes — common bug | no — single source of truth |
| Connector list in modal | mixed (some via custom connectors, some via SodaxWalletProvider) | unified via `useXConnectors({ xChainType: 'EVM' })` |

---

## Restricting the modal to specific wallets

`EVM.walletConnect` extends wagmi's `WalletConnectParameters` — full options available. To show only one specific wallet (e.g. when integrating with a single enterprise custody provider) and hide the rest:

```tsx
// @ai-snippets-skip
EVM: {
  walletConnect: {
    projectId: 'wc-cloud-project-id',
    qrModalOptions: {
      explorerRecommendedWalletIds: ['<target-wallet-id>'],
      explorerExcludedWalletIds: 'ALL',
    },
  },
},
```

Wallet IDs come from the [WalletConnect Explorer](https://cloud.walletconnect.com/sign-in). Filter options:

| Option | Effect |
|---|---|
| `explorerRecommendedWalletIds` | Prioritized at the top of the QR modal. |
| `explorerExcludedWalletIds: 'ALL'` | Hides every wallet not in `explorerRecommendedWalletIds`. |
| `explorerExcludedWalletIds: ['id1', 'id2']` | Hides specific wallets only. |

---

## Migration steps

1. **Remove the hand-rolled `WagmiProvider` and `createConfig`.** v2 builds wagmi config internally.
2. **Move `projectId`** into `walletConfig.EVM.walletConnect.projectId`.
3. **Move any `qrModalOptions`** (e.g. wallet filters) into `walletConfig.EVM.walletConnect.qrModalOptions`.
4. **Verify** that `useXConnectors({ xChainType: 'EVM' })` returns both EIP-6963 connectors and the WalletConnect entry.
5. **Drop** any custom hooks / state that bridged between the two wagmi configs in v1.

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Confirm no manual WagmiProvider remains
grep -rn "WagmiProvider" <user-src>
# expect empty (or only inside the wallet-sdk-react package itself if the user has a deep import — flag and remove)

# 3. Confirm walletConnect config is in walletConfig
grep -rn "walletConnect" <user-src> | grep -i "projectId"
# expect at least one match in the provider file

# 4. Manual — load app, open connect modal, confirm WalletConnect option appears
```

---

## Common pitfalls

- **Missing projectId.** Without `projectId`, the WalletConnect connector won't initialize. Get one free at [cloud.walletconnect.com](https://cloud.walletconnect.com).
- **Bundling EIP-6963 + WalletConnect.** The two are additive — `useXConnectors` returns both. UI should let users pick.
- **`qrModalOptions.explorerExcludedWalletIds` typo.** It's `'ALL'` (string), not `true` or `'all'`.
- **Multiple SodaxWalletProvider mounts.** Don't mount one with WalletConnect and another without — define `walletConfig` once at the app root.
