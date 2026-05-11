# Recipe: Migrate Next.js SSR Setup

Migrates the SSR-specific provider setup. Both `initialState` and `reconnectOnMount` move **into the `EVM` slot** of the new `config` prop — they are not removed in v2. Self-contained — apply this recipe without reading other files.

---

## When to use this recipe

Apply when the user's v1 code:

- Passes `initialState={...}` to `SodaxWalletProvider`
- Has a server component or page that calls `cookieToInitialState` (wagmi)
- Sets `options.wagmi.ssr: true` and/or `options.wagmi.reconnectOnMount`

If the project is **not** Next.js (Vite, CRA), only the prop-shape rewrite applies; `initialState` plumbing is not needed.

---

## Before (v1)

```diff
- // app/layout.tsx — v1 ❌
- import { headers } from 'next/headers';
- import { cookieToInitialState } from 'wagmi';
- import { SodaxWalletProvider } from '@sodax/wallet-sdk-react';
- import { createWagmiConfig } from '@sodax/wallet-sdk-react'; // hypothetical helper consumers used
-
- const rpcConfig = {
-   'sonic': 'https://rpc.soniclabs.com',
-   '0x1.eth': 'https://ethereum-rpc.publicnode.com',
- };
-
- export default async function RootLayout({ children }: { children: React.ReactNode }) {
-   const headersList = await headers();
-   const cookie = headersList.get('cookie');
-
-   // Build wagmi config the same way the package built it internally to derive initialState
-   const wagmiConfig = createWagmiConfig(rpcConfig, { ssr: true });
-   const initialState = cookieToInitialState(wagmiConfig, cookie);
-
-   return (
-     <html>
-       <body>
-         <SodaxWalletProvider
-           rpcConfig={rpcConfig}
-           options={{ wagmi: { ssr: true, reconnectOnMount: true } }}
-           initialState={initialState}
-         >
-           {children}
-         </SodaxWalletProvider>
-       </body>
-     </html>
-   );
- }
```

---

## After (v2)

```tsx
// app/layout.tsx — v2 ✅
import { headers } from 'next/headers';
import { cookieToInitialState } from 'wagmi';
import { ChainKeys } from '@sodax/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { createWagmiConfig } from '@sodax/wallet-sdk-react/xchains/evm';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    reconnectOnMount: true,
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
    },
  },
  // Add other chain slots as needed
};

const queryClient = new QueryClient();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookie = (await headers()).get('cookie');
  // Re-derive initialState from cookies to avoid disconnect-flash on first render.
  const wagmiConfig = createWagmiConfig(walletConfig.EVM!);
  const initialState = cookieToInitialState(wagmiConfig, cookie);

  const evmConfig = { ...walletConfig.EVM!, initialState };
  const config: SodaxWalletConfig = { ...walletConfig, EVM: evmConfig };

  return (
    <html>
      <body>
        <QueryClientProvider client={queryClient}>
          <SodaxWalletProvider config={config}>{children}</SodaxWalletProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
```

If you don't need to avoid the first-render disconnect flash, drop the cookie / `initialState` plumbing entirely — `EVM.ssr: true` alone is enough for the typical SSR app.

---

## What changed

| Concern | v1 | v2 |
|---|---|---|
| `rpcConfig` flat dict | top-level prop | nested under `EVM.chains[<ChainKey>].rpcUrl` |
| `options.wagmi.ssr` | nested under `options.wagmi` | `EVM.ssr: true` |
| `options.wagmi.reconnectOnMount` | nested under `options.wagmi` | `EVM.reconnectOnMount` (still supported, default `false`) |
| `initialState` | top-level prop | `EVM.initialState` (still supported — pass `cookieToInitialState(...)` for Next.js cookie hydration) |
| `QueryClient` | created internally by `SodaxWalletProvider` | created by caller, wrapped with `QueryClientProvider` |

---

## Migration steps

1. **Move per-chain RPC URLs.** Move `rpcConfig['sonic']` etc. into `EVM.chains[ChainKeys.SONIC_MAINNET].rpcUrl`. Use `ChainKeys` constants from `@sodax/types`.
2. **Collapse `options.wagmi.*` into `EVM.*`.** `options.wagmi.ssr` → `EVM.ssr`, `options.wagmi.reconnectOnMount` → `EVM.reconnectOnMount`.
3. **Move `initialState` into `EVM.initialState`.** v2 still accepts wagmi cookie state; the prop name and location changed, not the feature.
4. **Add `QueryClientProvider`.** Create a `QueryClient` (top-level module constant — singleton across renders) and wrap `SodaxWalletProvider` with `<QueryClientProvider>`.
5. **Make sure `@tanstack/react-query` is a direct dep.** Add it if missing:
   ```bash
   pnpm add @tanstack/react-query
   ```
6. **Confirm consumer components are `'use client'`.** Hooks (`useXAccount`, `useXConnect`, etc.) only run on the client — any component that calls them needs the directive.

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. No top-level v1 props remain on SodaxWalletProvider
grep -rnE "SodaxWalletProvider[^>]*\b(rpcConfig|options|initialState)\s*=" <user-src>
# expect empty

# 3. EVM.ssr: true is set
grep -rnE "EVM:\s*\{[^}]*\bssr:\s*true" <user-src>
# expect at least one match

# 4. QueryClientProvider wraps SodaxWalletProvider
# (manual — open layout.tsx, confirm nesting)

# 5. Manual — pnpm build && pnpm start, load page, confirm no hydration mismatch warnings in console
```

---

## Common pitfalls

- **Forgetting `'use client'` on consumer components.** If you call `useXAccount` / `useXConnect` in a Server Component, you'll get "useEffect cannot be called from a server component". Wrap the consumer in a client component.
- **Creating `QueryClient` inside the layout component.** Each render creates a new client and React Query loses its cache. Define `queryClient` as a **module-level constant**, or use `useState(() => new QueryClient())` inside a client component.
- **Pages Router project.** This recipe assumes App Router. For Pages Router, mount the providers in `_app.tsx` instead — the API is the same.
- **Dynamic RPC URLs from env vars.** If `rpcUrl` comes from `process.env.NEXT_PUBLIC_*`, ensure the env var is available at module init time (it is, by Next.js convention). Don't compute the config inside a hook — `SodaxWalletProvider` freezes config on first render, so config must be stable.
