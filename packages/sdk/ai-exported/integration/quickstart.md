# Quickstart — `@sodax/sdk` v2

Get a `Sodax` instance running in your project.

## Section index

1. [Installation](#1-installation)
2. [Node-server setup (private key)](#2-node-server-setup-private-key)
3. [Next.js / browser dApp setup](#3-nextjs--browser-dapp-setup)
4. [First-time troubleshooting](#4-first-time-troubleshooting)

---

## 1. Installation

```bash
pnpm add @sodax/sdk
# or
npm install @sodax/sdk
# or
yarn add @sodax/sdk
```

**Don't add `@sodax/types` separately.** `@sodax/sdk` re-exports the entire types surface from its barrel. Adding `@sodax/types` as a direct dependency invites version skew on the next minor bump.

For browser / React apps, you'll also want a wallet layer:

```bash
pnpm add @sodax/wallet-sdk-core @sodax/wallet-sdk-react
```

For Node bots / scripts, `@sodax/wallet-sdk-core` alone is enough.

### TypeScript

Targets Node 18+ and modern browsers. The package ships dual ESM (`.mjs`) + CJS (`.cjs`) + DTS, with `"type": "module"`. No additional TypeScript config needed — the package's `exports` field handles resolution for both `tsc` and `bundler` `moduleResolution` modes.

If you're on `moduleResolution: 'node'` (legacy), upgrade to `'bundler'` or `'node16'` / `'nodenext'` — `'node'` doesn't read the `exports` field and will fall back to `main` / `module` (which still work, but you may see resolution warnings).

---

## 2. Node-server setup (private key)

Backend partner pattern. No browser extension; the wallet is a private key in environment.

```ts
// src/index.ts
import { Sodax, ChainKeys } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';

async function main() {
  // 1. Construct the wallet provider for your source chain.
  const evmWallet = new EvmWalletProvider({
    privateKey: process.env.PRIVATE_KEY as `0x${string}`,
    rpcUrl: process.env.ARBITRUM_RPC_URL!,
  });

  // 2. Construct Sodax. Pass RPC URLs you want to override; defaults work otherwise.
  const sodax = new Sodax({
    rpcConfig: {
      [ChainKeys.ARBITRUM_MAINNET]: process.env.ARBITRUM_RPC_URL!,
      [ChainKeys.SONIC_MAINNET]: process.env.SONIC_RPC_URL!,
    },
  });

  // 3. Initialize config (loads from backend; falls back to packaged defaults).
  await sodax.config.initialize();

  // 4. Use it.
  const result = await sodax.swaps.createIntent({
    params: {
      srcChainKey: ChainKeys.ARBITRUM_MAINNET,
      dstChainKey: ChainKeys.STELLAR_MAINNET,
      srcAddress: await evmWallet.getWalletAddress(),
      /* … rest of params */
    },
    raw: false,
    walletProvider: evmWallet,
  });

  if (!result.ok) {
    console.error(result.error.message, result.error.toJSON());
    process.exit(1);
  }

  console.log('intent created:', result.value.tx);
}

main();
```

Run with:

```bash
PRIVATE_KEY=0x… ARBITRUM_RPC_URL=https://… SONIC_RPC_URL=https://… node --import tsx src/index.ts
```

### Multi-chain bots

Construct one wallet provider per chain family at startup; pick the right one at call time. See [`recipes.md`](recipes.md) § "Backend-server initialization".

---

## 3. Next.js / browser dApp setup

For React apps, use `@sodax/wallet-sdk-react`'s `SodaxWalletProvider` and `useWalletProvider` hook. The integration boundary between React and the SDK is one hook call.

### Install

```bash
pnpm add @sodax/sdk @sodax/wallet-sdk-react @tanstack/react-query
```

### Provider stack (`app/providers.tsx`)

```tsx
'use client';

import { SodaxProvider } from '@sodax/dapp-kit';
import { SodaxWalletProvider } from '@sodax/wallet-sdk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <SodaxProvider config={{ /* DeepPartial<SodaxConfig> */ }}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider>
          {children}
        </SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
```

### Use in a component

```tsx
'use client';

import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { useSodaxContext } from '@sodax/dapp-kit';
import { ChainKeys } from '@sodax/sdk';

export function SwapButton() {
  const { sodax } = useSodaxContext();
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.ARBITRUM_MAINNET });

  async function handleSwap() {
    if (!walletProvider) return;
    const result = await sodax.swaps.createIntent({
      params: {
        srcChainKey: ChainKeys.ARBITRUM_MAINNET,
        srcAddress: await walletProvider.getWalletAddress() as `0x${string}`,
        /* … */
      },
      raw: false,
      walletProvider,
    });
    if (!result.ok) console.error(result.error);
  }

  return <button onClick={handleSwap}>Swap</button>;
}
```

> The `xChainId` parameter name on `useWalletProvider` is **not** a v2 typo — it's preserved from v1 for backwards compatibility. Don't grep-replace it to `chainKey`.

### App-router specifics

- `SodaxProvider` and `SodaxWalletProvider` are client components. Keep them in a `'use client'` boundary.
- `useWalletProvider`, `useSodaxContext`, and the dapp-kit hooks (`useSwap`, `useSupply`, …) are all client-only.
- For server-side rendering, you can render placeholder UI and hydrate the wallet state on the client.

---

## 4. First-time troubleshooting

The 10 errors most likely on a fresh install.

### "Cannot find module '@sodax/sdk' or its corresponding type declarations"

- TypeScript `moduleResolution` is `'node'` (legacy). Switch to `'bundler'` or `'node16'`/`'nodenext'`.
- Or: clear `node_modules` and reinstall. `@sodax/sdk` ships dual exports; resolution should be automatic.

### "Module '\"@sodax/sdk\"' has no exported member 'SONIC_MAINNET_CHAIN_ID'"

- v1 constant name. Use `ChainKeys.SONIC_MAINNET`. See [`../migration/breaking-changes/type-system.md`](../migration/breaking-changes/type-system.md) § 1.

### "Object literal may only specify known properties, and 'walletProvider' does not exist in type ..."

- Forgot `raw: false` (or `raw: true`) discriminator on the call. Add it.
- See [`architecture.md`](architecture.md) § 6.

### "Property 'tx' does not exist on type 'SwapResponse'" or similar

- You're treating the return as the success value directly instead of unpacking `result.value`. v2 returns `Promise<Result<T>>` — branch on `result.ok` first.
- See [`architecture.md`](architecture.md) § 7.

### `sodax.config.findSupportedTokenBySymbol` returns `undefined`

- `await sodax.config.initialize()` wasn't called. Add it after `new Sodax()`.

### "Property 'xChainId' does not exist on type 'XToken'"

- `XToken.xChainId` was renamed to `XToken.chainKey`. See [`../migration/breaking-changes/type-system.md`](../migration/breaking-changes/type-system.md) § 4.

### "Type '{ token, amount, action }' does not satisfy the expected type 'MoneyMarketSupplyParams'"

- Missing `srcChainKey` and `srcAddress` (required in v2). See [`features/money-market.md`](features/money-market.md).

### "Argument of type 'string' is not assignable to parameter of type 'GetAddressType<K>'"

- For EVM chains, `GetAddressType<K>` is `` `0x${string}` ``. Cast at the boundary: `address as \`0x${string}\``.
- See [`recipes.md`](recipes.md) § "Chain-key narrowing".

### `sodax.config.initialize()` hangs / errors

- The backend API is unreachable. The SDK should fall back to packaged defaults silently — check your network, then check that `SodaxConfig.backendApi.url` is correct (or omit it for the default).

### Stellar bridge / swap fails with `'Trustline missing'`

- Stellar destinations require a trustline for the destination asset before they can receive it. See [`chain-specifics.md`](chain-specifics.md) § "Stellar trustline".

---

## Cross-references

- v2 architecture: [`architecture.md`](architecture.md).
- Recipes for common patterns: [`recipes.md`](recipes.md).
- Per-feature usage: [`features/`](features/).
- Lookup tables (chain keys, error codes, public API): [`reference.md`](reference.md).
- v1 → v2 porting: [`../migration/README.md`](../migration/README.md).
