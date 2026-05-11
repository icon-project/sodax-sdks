# Recipe: Adopt `defaults` (optional cleanup)

Replace hand-rolled wrappers with provider-level `defaults`. Optional — older per-call style still works.

**Apply when:** the user has a helper like `makeProvider(pk)` or `withDefaults(provider)` that injects fixed options on every call.

---

## Before — hand-rolled wrapper

```ts
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import type { EvmRawTransaction } from '@sodax/types';
import { ChainKeys } from '@sodax/types';

function makeEvmProvider(pk: `0x${string}`) {
  const provider = new EvmWalletProvider({ privateKey: pk, chainId: ChainKeys.SONIC_MAINNET });

  return {
    ...provider,
    sendTransaction(tx: EvmRawTransaction) {
      // hard-coded gas on every call
      return provider.sendTransaction(tx, { gas: 3_000_000n });
    },
  };
}
```

## After — provider-level `defaults`

```ts
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/types';

const provider = new EvmWalletProvider({
  privateKey: process.env.EVM_PK as `0x${string}`,
  chainId: ChainKeys.SONIC_MAINNET,
  defaults: {
    sendTransaction: { gas: 3_000_000n },
  },
});

// Use directly — defaults apply automatically; per-call override still works.
await provider.sendTransaction(tx);
await provider.sendTransaction(tx2, { gas: 5_000_000n });
```

---

## Steps

1. **Identify the wrapper.** Look for functions that wrap a provider and inject options on every method call.
2. **Move the injected options into `defaults`.** Pick the right slice — `defaults.sendTransaction` for EVM, `defaults.signAndExecuteTxn` for Sui, flat `defaults` for Bitcoin / Stellar / ICON / Injective / NEAR / Stacks.
3. **Delete the wrapper.** Replace call sites with direct provider method calls.
4. **Keep behavior for callers that already pass options.** Per-call options shallow-merge over defaults, so existing call sites that pass `{ gas: 5_000_000n }` still get exactly that gas value.

---

## When NOT to adopt

| Scenario | Why skip |
|---|---|
| The wrapper does more than inject defaults (e.g. logging, telemetry, retries) | `defaults` is just a config slice; it can't do behavior wrapping. Keep the wrapper. |
| The "default" actually changes per call (e.g. dynamic gas estimation) | That's not a default — it's per-call logic. Keep it inline. |
| The user's code base would gain churn for trivial savings | Migration cost > value. Leave it. |

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Search for remaining hand-rolled wrappers (heuristic)
grep -rnE "function\s+(make|build|with)(Wallet|Evm|Solana|Sui|Bitcoin|Stellar|Icon|Injective|Near|Stacks)Provider" <user-src>
# review each — confirm each is justified per the table above
```

---

## Why

See [`../breaking-changes/defaults-config.md`](../breaking-changes/defaults-config.md) for the model.
