# Recipe: Migrate Next.js SSR Setup

Migrates the SSR-specific provider setup. Most of the change here is **dropping the `initialState` plumbing** that v1 needed and using v2's `EVM.ssr: true` flag instead. Self-contained — apply this recipe without reading other files.

---

## When to use this recipe

Apply when the user's v1 code:

- Passes `initialState={...}` to `SodaxWalletProvider`
- Has a server component or page that calls `cookieToInitialState` (wagmi)
- Sets `options.wagmi.ssr: true`

If the project is **not** Next.js (Vite, CRA), only the `options.wagmi.ssr` → `EVM.ssr` rename applies.

---

## Before (v1)

```tsx
// app/layout.tsx — v1 ❌
import { headers } from 'next/headers';
import { cookieToInitialState } from 'wagmi';
import { SodaxWalletProvider } from '@sodax/wallet-sdk-react';
import { createWagmiConfig } from '@sodax/wallet-sdk-react'; // hypothetical helper consumers used

const rpcConfig = {
  'sonic': 'https://rpc.soniclabs.com',
  '0x1.eth': 'https://ethereum-rpc.publicnode.com',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const cookie = headersList.get('cookie');

  // Build wagmi config the same way the package built it internally to derive initialState
  const wagmiConfig = createWagmiConfig(rpcConfig, { ssr: true });
  const initialState = cookieToInitialState(wagmiConfig, cookie);

  return (
    <html>
      <body>
        <SodaxWalletProvider
          rpcConfig={rpcConfig}
          options={{ wagmi: { ssr: true, reconnectOnMount: false } }}
          initialState={initialState}
        >
          {children}
        </SodaxWalletProvider>
      </body>
    </html>
  );
}
```

---

## After (v2)

```tsx
// app/layout.tsx — v2 ✅
import { ChainKeys } from '@sodax/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
    },
  },
  // Add other chain slots as needed
};

const queryClient = new QueryClient();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <QueryClientProvider client={queryClient}>
          <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
```

---

## What changed

| Concern | v1 | v2 |
|---|---|---|
| `rpcConfig` flat dict | top-level prop | nested under `EVM.chains[<ChainKey>].rpcUrl` |
| `options.wagmi.ssr` | nested under `options.wagmi` | `EVM.ssr: true` |
| `options.wagmi.reconnectOnMount` | option flag | removed (wagmi default applies) |
| `initialState` | top-level prop, derived from cookies in a server component | **removed** — v2 handles SSR hydration internally when `EVM.ssr: true` |
| `QueryClient` | created internally by `SodaxWalletProvider` | created by caller, wrapped with `QueryClientProvider` |
| Server component required | yes (to read cookies) | not needed for wallet hydration |
| `'use client'` on layout | depends on app | not needed at layout level — but consumers of hooks must be `'use client'` |

---

## Migration steps

1. **Drop the cookie-reading server logic.** Remove `headers()`, `cookieToInitialState`, `createWagmiConfig` calls. The layout can be a plain (non-async) component.
2. **Remove `initialState` prop.** v2 `SodaxWalletProvider` doesn't accept it.
3. **Build `walletConfig`.** Move `rpcConfig` URLs into `EVM.chains[<ChainKey>].rpcUrl`. Set `EVM.ssr: true`.
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

# 2. No initialState prop remains
grep -rnE "initialState\s*=" <user-src> | grep -i "wallet\|wagmi"
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
