# Recipe: Migrate a Single-Chain Connect Button

Migrates the most common pattern: one button per chain that lists connectors, lets the user pick one, and shows the connected address. Self-contained — apply this recipe without reading other files.

---

## When to use this recipe

Apply when the user's v1 code uses any of:

- `useXConnectors('<chain>')` (positional)
- `useXAccount('<chain>')` (positional)
- `useXConnect()` + `useXDisconnect()` for a per-chain button

If the user has a multi-chain modal (chain picker → connector picker), use [`multi-chain-modal.md`](./multi-chain-modal.md) instead.

---

## Before (v1)

```tsx
// @ai-snippets-skip
'use client';

import {
  useXConnectors,
  useXConnect,
  useXAccount,
  useXDisconnect,
} from '@sodax/wallet-sdk-react';

export function EvmConnectButton() {
  const connectors = useXConnectors('EVM');
  const { mutateAsync: connect, isPending } = useXConnect();
  const { address } = useXAccount('EVM');
  const disconnect = useXDisconnect();

  if (address) {
    return (
      <div>
        Connected: {address}
        <button onClick={() => disconnect('EVM')}>Disconnect</button>
      </div>
    );
  }

  return (
    <div>
      {connectors.map((connector) => (
        <button
          key={connector.id}
          disabled={isPending}
          onClick={() => connect(connector)}
        >
          Connect with {connector.name}
        </button>
      ))}
    </div>
  );
}
```

---

## After (v2)

```tsx
'use client';

import {
  useXConnectors,
  useXConnect,
  useXAccount,
  useXDisconnect,
} from '@sodax/wallet-sdk-react';

export function EvmConnectButton() {
  const connectors = useXConnectors({ xChainType: 'EVM' });
  const { mutateAsync: connect, isPending } = useXConnect();
  const { address } = useXAccount({ xChainType: 'EVM' });
  const disconnect = useXDisconnect();

  if (address) {
    return (
      <div>
        Connected: {address}
        <button onClick={() => disconnect({ xChainType: 'EVM' })}>Disconnect</button>
      </div>
    );
  }

  return (
    <div>
      {connectors.map((connector) => (
        <button
          key={connector.id}
          disabled={isPending}
          onClick={() => connect(connector)}
        >
          Connect with {connector.name}
        </button>
      ))}
    </div>
  );
}
```

---

## What changed

| Line | v1 | v2 |
|---|---|---|
| `useXConnectors` | `useXConnectors('EVM')` | `useXConnectors({ xChainType: 'EVM' })` |
| `useXAccount` | `useXAccount('EVM')` | `useXAccount({ xChainType: 'EVM' })` |
| `useXConnect` mutation arg | pass `connector` to `mutateAsync` | unchanged |
| `useXDisconnect` returned callback | `disconnect('EVM')` | `disconnect({ xChainType: 'EVM' })` |

The mechanical changes are the **three hook usages** above. The `useXDisconnect` callback shape changed in v2 — see [`../reference/hooks.md`](../reference/hooks.md) § `useXDisconnect`.

---

## Variations

### Per-chain-id (e.g. one connect button per EVM network)

If v1 used `useXAccount('0x1.eth')`:

```tsx
// @ai-snippets-skip
// v1 ❌
const { address } = useXAccount('0x1.eth');
```

Use the typed chain key in v2:

```tsx
// @ai-snippets-skip
// v2 ✅
import { ChainKeys } from '@sodax/types';
const { address } = useXAccount({ xChainId: ChainKeys.ETHEREUM_MAINNET });
```

> ⚠️ If the v1 button is "connect to Ethereum", remember v2 treats EVM as a **single connection across every configured EVM network**. A per-Ethereum button is rarely what users want — consider replacing with a single "EVM" button + `useEvmSwitchChain` for network switching. See [`../breaking-changes.md`](../breaking-changes.md) §7.

### Sui / Solana / etc.

Replace `'EVM'` with the chain type the button targets — the migration is mechanical:

```tsx
// @ai-snippets-skip
const connectors = useXConnectors({ xChainType: 'SUI' });
const { address } = useXAccount({ xChainType: 'SUI' });
```

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Confirm no positional hook args remain in this file
grep -nE "useXAccount\(['\"]" <file>
grep -nE "useXConnectors\(['\"]" <file>
# expect empty

# 3. Manual — load page, click connect, confirm address renders
```
