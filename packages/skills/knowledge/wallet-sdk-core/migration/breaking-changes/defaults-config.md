# `defaults` config added to every provider

**Additive — no action required.** Older code continues to compile.

---

## What changed

Every `*WalletConfig` gained an optional `defaults?: *WalletDefaults` field. Per-call methods accept an `options?: …` parameter that **shallow-merges** over the relevant slice of `defaults`.

```ts
// Older: explicit options on every call
const provider = new EvmWalletProvider({ privateKey, chainId });
await provider.sendTransaction(tx, { gas: 3_000_000n });   // every call needs gas

// Current: encode the default once, override per call when needed
const provider = new EvmWalletProvider({
  privateKey,
  chainId,
  defaults: { sendTransaction: { gas: 3_000_000n } },
});
await provider.sendTransaction(tx);                          // gas applied automatically
await provider.sendTransaction(tx2, { gas: 5_000_000n });    // override per call
```

## Why

Three reasons:

1. **Env-level constants belong with construction.** RPC commitment, default gas, default memo are tied to the **environment** (devnet vs mainnet, internal vs public RPC). Embedding them per-call leads to drift.
2. **Hand-rolled wrappers were the previous workaround.** Older code often had a `makeProvider(opts)` helper that injected defaults at every call site. Now that lives in the provider.
3. **Type-level safety.** Each chain's `*WalletDefaults` is precisely typed — invalid combinations fail at compile time, not at runtime.

## Merge semantics

| Style | When used | Behavior |
|---|---|---|
| `mergePolicy('key', options)` | Defaults grouped per method (EVM, Solana, Sui) | `shallowMerge(defaults.key, options)` |
| `mergeDefaults(options)` | Defaults are a flat object (Bitcoin, Stellar, ICON, Injective, NEAR, Stacks) | `shallowMerge(defaults, options)` |

Shallow only. Nested objects are **replaced wholesale**, not deep-merged. See [`../../integration/recipes/defaults-and-overrides.md`](../../integration/recipes/defaults-and-overrides.md).

## Consumer impact

| Older pattern | Replacement (optional) |
|---|---|
| `await provider.sendTransaction(tx, { gas })` on every call | `defaults: { sendTransaction: { gas } }` once at construction |
| `function makeEvmProvider(pk) { /* injects gas via closure */ }` | Remove the wrapper; pass `defaults` directly to the constructor |
| `Object.assign(provider.options, …)` (if hacked into older code) | Mutating internal state is **not** supported. Use `defaults` at construction. |

## How to adopt

Only if you want the cleanup. Apply [`../recipes/adopt-defaults.md`](../recipes/adopt-defaults.md). Skip otherwise — the older per-call style still works.

## Browser-extension caveat

In browser-extension mode the **constructor-time slices** of `defaults` (e.g. EVM's `transport`, `publicClient`, `walletClient`) are **ignored** — the consumer already supplied built clients. A one-time `console.warn` is logged. The method-grouped slices (`sendTransaction`, `waitForTransactionReceipt`, …) still apply.
