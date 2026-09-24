# Recipe: Email Login with Privy (EVM only)

Add an **"Email (Privy)"** entry to the EVM wallet list: the user logs in with an email one-time code and gets a Privy embedded wallet that signs like any other EVM wallet. Opt-in, behind the `@sodax/wallet-sdk-react/privy` sub-path.

**Depends on:** [`setup.md`](./setup.md)

Before adding it, tell the user the trade-offs (full text in the package guide `docs/WALLET_PRIVY.md`): Privy custodies access, so no signing is possible while Privy is unreachable; addresses belong to their Privy app; a user who loses their email loses the wallet; their Privy app is billed per signature.

**App already on Privy?** If it mounts its own `PrivyProvider` only for email login and the embedded wallet, remove that provider, pass the same `appId` to `privy()` and skip step 1 (its `@privy-io/react-auth` must be 3.40 or newer). If it needs its own Privy configuration — other login methods, other chains, or a Privy session that must outlive a wallet disconnect — do not add `EVM.privy`: the SDK cannot use a provider the app mounts, and Privy allows only one.

---

## 1. Create a Privy app and install the peer

At dashboard.privy.io enable **Email** login and **Ethereum embedded wallets**, and allow the site's origins. Then:

```bash
pnpm add @privy-io/react-auth
```

`@privy-io/react-auth` is an optional peer of `@sodax/wallet-sdk-react` — it is not installed automatically.

---

## 2. Pass `privy()` as `EVM.privy`

```typescript
import { type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { privy } from '@sodax/wallet-sdk-react/privy';
import { ChainKeys } from '@sodax/types';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    chains: { [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://mainnet.base.org' } },
    // An unset env var only logs a warning and leaves "Email (Privy)" out; privy() never throws.
    privy: privy({ appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '' }),
  },
};
```

`useXConnectors({ xChainType: 'EVM' })` now includes a connector with `id === 'privy'`. **No UI changes required.** Options: `appId` (required), `clientId`, `defaultChain` (an EVM `ChainKey`, default Sonic), `showWalletUIs`, `disconnectBehavior` (`'logout'` by default — the next connect needs a new code; `'detach'` keeps the Privy session, so ask the user before choosing it for a shared-device audience), `appearance`, `legal`. If Privy cannot start (plain-http origin other than localhost, malformed app id, a second `PrivyProvider`), the app keeps running and picking "Email (Privy)" fails with the cause.

---

## 3. Read the Privy user (optional)

The SDK mounts `PrivyProvider` around the app, so Privy's own hooks work in child components. Render them only while the EVM wallet is the Privy one:

```tsx
// @ai-snippets-skip — imports the optional peer @privy-io/react-auth, which this package does not install
import { usePrivy } from '@privy-io/react-auth';
import { useXConnection } from '@sodax/wallet-sdk-react';

export function PrivyEmail() {
  const connection = useXConnection({ xChainType: 'EVM' });
  return connection?.xConnectorId === 'privy' ? <Email /> : null;
}

function Email() {
  const { user } = usePrivy();
  return <span>{user?.email?.address}</span>;
}
```

---

## Anti-patterns

- **Writing `privy: { appId }`.** The value must come from `privy()` — the import is what adds Privy's code to the bundle; a plain object is skipped with a warning.
- **Importing `privy` from `@sodax/wallet-sdk-react`.** It lives only on the `/privy` sub-path.
- **Calling `privy()` in a Server Component.** Its value belongs to the browser's copy of the SDK and React refuses to serialize it; build the config in a `'use client'` file.
- **Mounting a second `PrivyProvider`.** Privy allows one; for an app that already has one, see *App already on Privy?* above.
- **Adding `@privy-io/wagmi`.** Not used — it replaces wagmi's connector list and would remove MetaMask and WalletConnect.
- **Custom modal stacking.** While Privy's login dialog is open, `useWalletModal` is `connecting`; render nothing when `state.connector.id === 'privy'`, as for `'walletConnect'`.
