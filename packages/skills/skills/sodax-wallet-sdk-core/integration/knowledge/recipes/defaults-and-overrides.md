# Recipe: Defaults and per-call overrides

Configure the `defaults` slice and understand the shallow-merge semantics shared by every provider.

**Depends on:** [`setup-private-key.md`](./setup-private-key.md) or [`setup-browser-extension.md`](./setup-browser-extension.md).

---

## Mental model

Every provider class extends `BaseWalletProvider<TDefaults>`. `defaults` is captured at construction time; per-call `options` are shallow-merged over the relevant slice at call time:

```
final  = shallowMerge(defaults[key], options)        // mergePolicy('key', options)
       OR
       = shallowMerge(defaults, options)              // mergeDefaults(options)
```

Two helpers, two shapes:

| Helper | When the chain uses it | Example |
|---|---|---|
| `mergePolicy('foo', opts)` | `defaults` is **grouped per method** | EVM: `defaults.sendTransaction`, `defaults.waitForTransactionReceipt` |
| `mergeDefaults(opts)` | `defaults` is **flat** | Bitcoin: `defaultFinalize`; Stellar: `pollInterval`, `pollTimeout` |

For the helper each chain uses, see [`../features/<chain>.md`](../features/).

---

## Shallow, not deep

Top-level keys merge; **nested objects are replaced wholesale**.

```ts
const provider = new EvmWalletProvider({
  // …
  defaults: {
    sendTransaction: { gas: 3_000_000n, nonce: 0 },
  },
});

await provider.sendTransaction(txData, { gas: 5_000_000n });
//                                       ^^^^^^^^^^^^^^^^
// Final policy: { gas: 5_000_000n }     ← nonce is DROPPED
```

If you need `nonce` to persist, include it in the per-call options:

```ts
await provider.sendTransaction(txData, { gas: 5_000_000n, nonce: 0 });
```

Or split the default so each tunable lives at the top level — see `src/utils/merge.ts` for the implementation. The behavior is intentional: deep merge would silently smuggle stale fields across call sites.

---

## `undefined` is "no opinion"

The merge skips:

- `undefined` **layers** entirely (no options object → use defaults verbatim).
- `undefined` **values** inside a layer (`{ gas: undefined }` does **not** override the previous layer).

```ts
const policy: Partial<EvmSendTransactionPolicy> = { gas: undefined };
await provider.sendTransaction(txData, policy);
// gas falls back to defaults.sendTransaction.gas
```

This is useful when threading options through optional parameters — `undefined` reads as "use the default".

---

## Where to put what

| Tunable | Goes where | Why |
|---|---|---|
| Env-level constants (RPC URL, default gas, default commitment) | `defaults` at construction | One place, captured at startup |
| Per-call tweaks (this tx needs more gas) | per-call `options` argument | Localized, doesn't leak into other calls |
| Anything that changes after construction (active network in PK mode) | re-construct the provider | `defaults` is frozen at startup |

You **cannot** mutate `defaults` after construction — `BaseWalletProvider` captures the reference into a `protected readonly` field. Later mutations have no effect.

---

## Worked example: EVM with two default slices

```ts
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/types';

const provider = new EvmWalletProvider({
  privateKey: process.env.PK as `0x${string}`,
  chainId: ChainKeys.SONIC_MAINNET,
  defaults: {
    // Slice grouped by method — merged via mergePolicy('sendTransaction', …)
    sendTransaction: { gas: 3_000_000n },

    // Another method-grouped slice
    waitForTransactionReceipt: { confirmations: 1, timeout: 60_000 },

    // Constructor-time slices (private-key mode only — ignored in browser-extension mode)
    transport: { batch: { batchSize: 10 } },
  },
});

// Default gas: 3M.  This call bumps to 5M.
const hash = await provider.sendTransaction(tx, { gas: 5_000_000n });

// Default 1 confirmation, 60s timeout.  This call overrides both.
const receipt = await provider.waitForTransactionReceipt(hash, {
  confirmations: 2,
  timeout: 30_000,
});
```

---

## Browser-extension warning

In **browser-extension** mode the constructor-time slices (`transport`, `publicClient`, `walletClient` on EVM; analogous on other chains) are **ignored** — the consumer already supplied built clients, so there is nothing for the provider to configure. A one-time `console.warn` is logged.

```
[EvmWalletProvider] defaults.{transport,publicClient,walletClient} ignored in browser-extension mode.
```

This is informational, not a bug. The method-grouped slices (`sendTransaction`, `waitForTransactionReceipt`, …) still apply in both modes.

---

## Verification

```ts
// Assert that defaults applied — run on a testnet
const hash = await provider.sendTransaction(tx);  // no per-call options
// Then read the receipt and confirm gas matches your default
```

```bash
pnpm checkTs
```

---

## Common pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Expecting deep merge | A nested field was "dropped" | The whole object was replaced. Include both fields in the per-call options. |
| Mutating `defaults` after construction | Tunable doesn't take effect | Reconstruct the provider, or pass the new value per call. |
| Setting transport defaults in browser-extension mode | Warning logged, no effect | Move them out — they only apply in PK mode. |
| Putting RPC URL in `defaults` | RPC URL is a top-level config field on every chain, not a `defaults` slice | Use `rpcUrl: '…'` at the config root (PK mode), or pass `publicClient` / `client` directly (browser-extension mode). |

---

## See also

- [`../architecture.md`](../architecture.md) § `BaseWalletProvider` and the `defaults` model.
- [`../features/`](../features/) — per-chain `*Defaults` shape and which helper each chain uses.
