# Recipe: Switch EVM Chain

A single wagmi connection covers **every configured EVM network** (Sonic, Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, etc.). The user picks a wallet once; switching the **active network** is a separate concern handled by `useEvmSwitchChain`.

**Depends on:** [`setup.md`](./setup.md), [`connect-button.md`](./connect-button.md) or [`multi-chain-modal.md`](./multi-chain-modal.md)

---

## Why this exists

When you call `sodax.swaps.swap({ params: { srcChainKey: ChainKeys.BSC_MAINNET, ... }, walletProvider })`, the wallet provider must be **on BSC at signing time** — wagmi will reject the tx otherwise. But wagmi remembers the last network the user selected, so a user who connected via MetaMask on Ethereum and then opened your dApp's BSC swap form needs to switch first.

`useEvmSwitchChain` reads the connected EVM wallet's current chain id, compares against the chain id implied by `srcChainKey`, and exposes:

- `isWrongChain: boolean` — render a "Switch to BSC" CTA when `true`
- `handleSwitchChain()` — triggers wagmi's `switchChain()` (or `wallet_switchEthereumChain` for Injective MetaMask)

Without this hook you'd have to import wagmi directly and replicate the logic per-chain.

---

## Hook API

```typescript
import { useEvmSwitchChain } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
  xChainId: ChainKeys.BSC_MAINNET,
});
```

| Field | Type | Behavior |
|-------|------|----------|
| `isWrongChain` | `boolean` | `true` when the wallet's active chain id doesn't match `xChainId`. Always `false` for non-EVM/Injective chain ids. |
| `handleSwitchChain` | `() => void` | Triggers the network switch. No-op for chain ids that aren't EVM or Injective. |

The hook never throws — `handleSwitchChain` returns synchronously and lets wagmi (or `wallet_switchEthereumChain`) own the user-rejection error path.

---

## Standard EVM switch flow

```tsx
// @ai-snippets-skip
'use client';

import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

export function BscSwapButton() {
  const account = useXAccount({ xChainType: 'EVM' });
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
    xChainId: ChainKeys.BSC_MAINNET,
  });

  if (!account.address || !walletProvider) {
    return <ConnectCta />;
  }

  if (isWrongChain) {
    return <button onClick={handleSwitchChain}>Switch to BSC</button>;
  }

  return <button onClick={() => doSwap(walletProvider)}>Swap on BSC</button>;
}
```

`useSwitchChain` opens the wallet's network-switch popup; wagmi handles the chain-config-not-added flow (most wallets prompt to add the chain if it's missing).

---

## Pattern: gate every cross-chain action

For dApps where the source chain depends on user input (e.g. a swap form with a "from chain" picker), wire `useEvmSwitchChain` against the **selected** chain id:

```tsx
// @ai-snippets-skip
function SwapForm() {
  const [srcChainKey, setSrcChainKey] = useState<SpokeChainKey>(ChainKeys.SONIC_MAINNET);
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: srcChainKey });
  const walletProvider = useWalletProvider({ xChainId: srcChainKey });

  const buttonState =
    !walletProvider ? 'connect' :
    isWrongChain ? 'switch' :
    'swap';

  return (
    <>
      <ChainSelect value={srcChainKey} onChange={setSrcChainKey} />
      {buttonState === 'connect' && <ConnectCta />}
      {buttonState === 'switch' && <button onClick={handleSwitchChain}>Switch chain</button>}
      {buttonState === 'swap' && <button onClick={() => doSwap(walletProvider)}>Swap</button>}
    </>
  );
}
```

Re-renders on `srcChainKey` change automatically — no manual reset needed.

---

## Injective MetaMask special case

Injective offers MetaMask as a wallet option (in addition to Keplr, Leap). When MetaMask is the active Injective wallet, **the underlying Ethereum chain id must be mainnet (`1`)** — Injective uses MetaMask's `personal_sign` infrastructure which is bound to whatever EVM network the wallet is currently on.

```tsx
// @ai-snippets-skip
const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
  xChainId: ChainKeys.INJECTIVE_MAINNET,
});
// isWrongChain === true if user is on Injective via MetaMask AND active EVM chain is not mainnet (1)
// handleSwitchChain calls wallet_switchEthereumChain to chain id 0x1
```

Keplr and Leap on Injective don't have this constraint — `isWrongChain` is `false` for those wallets regardless of network state.

---

## Safe to call when EVM is disabled

`useEvmSwitchChain` checks `useEnabledChains()` and returns a no-op result `{ isWrongChain: false, handleSwitchChain: () => {} }` when the EVM slot isn't mounted in `SodaxWalletProvider` config. Calling wagmi's hooks outside a `WagmiProvider` would throw — the early-return lets components opt-in to a "switch chain" CTA without checking EVM-enabled themselves at every call site.

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Manual — connect MetaMask on Ethereum, open BSC swap form, confirm Switch button appears
# 3. Manual — click Switch, approve in MetaMask, confirm Swap button replaces it
# 4. Manual — switch to Polygon manually (in MetaMask), confirm Switch button reappears for BSC form
```

---

## Reference

- [wagmi `useSwitchChain`](https://wagmi.sh/react/api/hooks/useSwitchChain) — underlying hook
- [EIP-3326 — `wallet_switchEthereumChain`](https://eips.ethereum.org/EIPS/eip-3326) — RPC method spec
