---
'@sodax/types': minor
'@sodax/sdk': minor
---

Move `useBackendSubmitTx` onto `swaps` / `bridge` (alongside `partnerFee`) and default it to `true`. `new Sodax()` now uses the backend submit-tx path for swap and bridge unless you opt out.

The redundant `swapsOptions` / `bridgeOptions` keys and the `SwapsClientOptions` / `BridgeClientOptions` types are **deprecated but still honoured**, so existing code keeps compiling and an existing explicit `useBackendSubmitTx: false` keeps the client-side path. The new `swaps` / `bridge` key wins when both are set.

**Two behavior changes.** First: callers that never set the flag move from the client-side relay to the backend submit-tx path (which still falls back to the client-side relay on any non-success). Second — and this one reaches callers who explicitly opted out — `timeout` becomes a per-attempt budget instead of an end-to-end one: the client-side relay wait now starts fresh, after on-chain verification, rather than inheriting whatever a shared deadline had left. Nothing shortens that wait any more, but total wall-clock for a swap or bridge can now exceed a single `timeout`. If you sized an outer deadline or watchdog off `timeout`, re-check it — including on `useBackendSubmitTx: false`.

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
