---
'@sodax/types': minor
'@sodax/sdk': minor
---

Move `useBackendSubmitTx` onto `swaps` / `bridge` (alongside `partnerFee`) and default it to `true`. Remove the redundant `swapsOptions` / `bridgeOptions` keys and `SwapsClientOptions` / `BridgeClientOptions` types. `new Sodax()` now uses the backend submit-tx path for swap and bridge unless you opt out.

**Breaking within the 2.x line** — deliberate, and not deferred to a major: the removed option keys and types no longer compile, and the runtime default flips from off to on.

**Migration:**

```ts
// before
new Sodax({
  swapsOptions: { useBackendSubmitTx: true },
  bridgeOptions: { useBackendSubmitTx: true },
});

// after — default ON; omit the flag unless opting out
new Sodax();
new Sodax({
  swaps: { useBackendSubmitTx: false },
  bridge: { useBackendSubmitTx: false },
});
```

Because an omitted flag reads back as `undefined` rather than `true`, the effective value is exposed on `ConfigService`: `sodax.config.swapUseBackendSubmitTx` / `sodax.config.bridgeUseBackendSubmitTx` (resolved live, like `swapPartnerFee`). `sodax.swaps.useBackendSubmitTx` / `sodax.bridge.useBackendSubmitTx` return the same effective value.

Consequently `useBackendSubmitTx` is gone from `SwapServiceConstructorParams` / `BridgeServiceConstructorParams`, and the `readonly useBackendSubmitTx` field on both services is now a getter. Reading it is unchanged; only code that constructs `SwapService` / `BridgeService` directly is affected — build them via `new Sodax(...)`, which wires the toggle from config.
