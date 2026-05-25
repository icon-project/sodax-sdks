# Recipe: WalletConnect Setup (EVM only)

Enable WalletConnect protocol on the EVM slot for partners using enterprise custody (Fireblocks, Ledger Live, mobile-only wallets). Default EVM discovery (EIP-6963) only finds browser-extension wallets — WalletConnect lets users pair via QR / deep-link.

**Depends on:** [`setup.md`](./setup.md)

---

## When to use

| Scenario | Need WalletConnect? |
|----------|---------------------|
| MetaMask / Hana / Rabby browser extension | ❌ — EIP-6963 covers them |
| Enterprise custody wallets (e.g. Fireblocks, Safe) | ✅ |
| Ledger Live | ✅ |
| MetaMask Mobile / Trust / Rainbow (paired via QR) | ✅ |
| Coinbase Smart Wallet | ✅ (fallback path) |

If your dApp only targets desktop browser-extension wallets, omit `walletConnect` entirely.

---

## 1. Get a WalletConnect Cloud project id

Sign up at [https://cloud.walletconnect.com](https://cloud.walletconnect.com) and copy your project id. Add it to `.env`:

```bash
NEXT_PUBLIC_WC_PROJECT_ID=your-project-id
```

---

## 2. Add `walletConnect` to the `EVM` slot

```typescript
import { type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arb1.arbitrum.io/rpc' },
    },
    walletConnect: {
      projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID!,
      // showQrModal: true is the default — wagmi/WalletConnect own the QR display
    },
  },
};
```

A WalletConnect connector now surfaces alongside EIP-6963 wallets. `useXConnectors({ xChainType: 'EVM' })` returns it with `id === 'walletConnect'`. **No UI changes required** — your existing connect-button or modal already handles it.

---

## 3. Restrict the QR modal to a specific wallet (optional)

To show **only** one wallet in the WalletConnect modal (e.g. when integrating with a single enterprise custody provider), filter the WalletConnect Explorer list:

```typescript
const walletConfig: SodaxWalletConfig = {
  EVM: {
    walletConnect: {
      projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID!,
      qrModalOptions: {
        explorerRecommendedWalletIds: [
          '<target-wallet-id>', // hex from WalletConnect Explorer
        ],
        explorerExcludedWalletIds: 'ALL', // hide everything except recommended
      },
    },
  },
};
```

Find wallet IDs at the [WalletConnect Explorer](https://walletconnect.com/explorer) — they're the long hex strings in the URL, not the human names. Default (no `qrModalOptions`) shows the full WalletConnect wallet list.

---

## 4. Hide the Sodax modal during WalletConnect QR

When the user picks the WalletConnect connector, wagmi opens its own QR modal — two dialogs would stack. Detect WC by connector id and render `null`:

```typescript
import { useWalletModal } from '@sodax/wallet-sdk-react';

const modal = useWalletModal();

if (
  modal.state.kind === 'connecting' &&
  modal.state.connector.id === 'walletConnect'
) {
  return null; // wagmi's QR modal owns the screen
}
```

The `useWalletModal` state machine handles the `connecting → success | error` transition normally — only the rendering is conditionally blanked.

---

## Missing `projectId` — silent skip

Setting `walletConnect: {}` without a `projectId` (or with an empty string) **silently skips** the WalletConnect connector and logs a warning:

```
[wallet-sdk-react] walletConnect.projectId is required — WalletConnect connector skipped.
```

EIP-6963 wallets continue to work normally — the dApp degrades gracefully. This intentionally avoids forcing local-dev environments to plumb the env var.

---

## EVM-only

The `walletConnect` field only exists on the `EVM` slot. Solana, Bitcoin, etc. use their own native wallet adapters and don't share the WalletConnect protocol layer. Don't attempt `SOLANA: { walletConnect: ... }` — TypeScript will reject it.

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Confirm walletConnect projectId is set
grep -rn "walletConnect" <user-src> | grep -i "projectId"
# expect at least one match

# 3. Manual — open connect modal, confirm WalletConnect option appears alongside extension wallets
```

---

## Reference

- [wagmi `WalletConnectParameters`](https://wagmi.sh/core/api/connectors/walletConnect) — full options reference
- [WalletConnect Cloud](https://cloud.walletconnect.com) — get a `projectId`
