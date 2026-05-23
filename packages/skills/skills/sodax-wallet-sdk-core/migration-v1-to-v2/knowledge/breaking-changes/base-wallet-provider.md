# `BaseWalletProvider` introduced

**Additive — no action required.** Older code continues to compile.

---

## What changed

Every provider class now extends a shared abstract base, `BaseWalletProvider<TDefaults>`:

```ts
abstract class BaseWalletProvider<TDefaults extends object> {
  protected readonly defaults: TDefaults;

  constructor(defaults: TDefaults | undefined) {
    this.defaults = (defaults ?? {}) as TDefaults;
  }

  abstract getWalletAddress(): Promise<string>;

  protected mergePolicy<K extends keyof TDefaults>(key: K, options?: …): … { /* shallowMerge */ }
  protected mergeDefaults(options?: Partial<TDefaults>): TDefaults { /* shallowMerge */ }
}
```

Older RCs implemented each provider independently — some had ad-hoc default handling, others had none.

## Why

Three reasons to unify:

1. **Predictable merge semantics across chains.** Per-call options now shallow-merge over `defaults` the same way on every provider. No more chain-by-chain surprises.
2. **One place to add cross-cutting features.** Future helpers (e.g. telemetry hooks, per-call validation) plug in at the base class.
3. **Single source of truth for `getWalletAddress`.** Subclasses can narrow the return type to a chain-specific brand (`Address`, `IconEoaAddress`, …) without re-declaring the contract.

## Consumer impact

None — the abstract base is a maintainer concern. Consumers continue to:

- Construct `EvmWalletProvider`, `SolanaWalletProvider`, etc. with the same discriminated unions.
- Pass them via the `IXxxWalletProvider` interface to `@sodax/sdk`.

You should **not** extend `BaseWalletProvider` in user code — see [`../ai-rules.md`](../ai-rules.md) § "Stop conditions".

## How to verify it doesn't affect you

```bash
pnpm checkTs
# Should pass without changes if you didn't subclass providers manually.
```

If a typecheck fails because you previously declared `class Foo extends EvmWalletProvider` and overrode a private method, that override is now invalid — the base class made some helpers `protected`. Ask the user how they want to refactor.
