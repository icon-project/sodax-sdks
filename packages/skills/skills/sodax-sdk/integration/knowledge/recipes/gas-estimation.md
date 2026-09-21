# Gas estimation

Pre-flight gas estimation for raw-tx flows. Most signed flows include gas estimation internally; you only need this when building unsigned payloads.

```ts
// 1. Build the unsigned tx via a raw: true flow (same params you'd pass to a signed createIntent).
const built = await sodax.swaps.createIntent({ params, raw: true });
if (!built.ok) return;
const { tx } = built.value; // TxReturnType<C, true> — the unsigned tx object

// 2. Estimate gas for that tx on its chain. estimateGas takes { tx, chainKey } — no `params` wrapper.
const result = await sodax.swaps.estimateGas({ tx, chainKey: params.srcChainKey });

if (!result.ok) {
  // result.error: SodaxError<'VALIDATION_FAILED' | 'GAS_ESTIMATION_FAILED' | 'UNKNOWN'>
  if (result.error.code === 'GAS_ESTIMATION_FAILED') {
    // Retry — gas estimation failures are usually transient.
  }
  return;
}

const gasEstimate = result.value; // bigint (EVM); chain-family-specific for non-EVM
```

`estimateGas` returns chain-family-specific shapes — EVM gas params, Solana compute units, etc. See per-feature docs in [`../features/`](../features/) for specifics.

### Distinct from `LOOKUP_FAILED`

The SDK keeps `GAS_ESTIMATION_FAILED` as its own code (rather than folding into `LOOKUP_FAILED`) because retry semantics differ. Re-estimation is cheap and almost always the right move on transient failure. Generic `LOOKUP_FAILED` errors typically need user intervention.

---

## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../architecture.md`](../architecture.md) — concepts behind these patterns.
- [`../reference/`](../reference/) — chain keys, error codes, public API surface.
