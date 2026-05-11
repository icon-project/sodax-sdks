# Error shape crosswalk — v1 → v2

The shape and type of errors flowing through dapp-kit hooks changed in v2. The change is mostly SDK-level (one canonical `SodaxError<C>` replaces 7+ per-feature classes) but it surfaces in dapp-kit at the consumer level — wherever you catch or branch on errors from hooks.

## Where v2 errors appear

| Surface | v1 | v2 |
|---|---|---|
| `mutation.error` | Only on actual exceptions | Includes SDK `!ok` errors (now thrown inside `mutationFn`) |
| `mutation.data` | `Result<T>` (`{ ok, value, error }`) | Unwrapped success type `T`; SDK `!ok` flows to `mutation.error` |
| `mutateAsync` rejection | Only on exceptions | Includes SDK `!ok` rejections |
| `mutateAsyncSafe` `result.error` | (didn't exist) | Includes SDK `!ok` errors (re-packed from the throw) |
| `onError` callback | Fired only for exceptions | Fires for SDK `!ok` too |

The semantic shift is: v1 treated SDK `!ok` as "successful but with an error inside"; v2 treats it as a thrown error. See [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md) for the full picture.

## Error class crosswalk (SDK-level — leaks through)

In v1, each SDK feature had its own error class:

```ts
// @ai-snippets-skip — describes deleted v1 type surface, not runnable
// v1
class MoneyMarketError<C extends MoneyMarketErrorCode> extends Error { /* ... */ }
class IntentError<C extends IntentErrorCode> extends Error { /* ... */ }
class StakingError<C extends StakingErrorCode> extends Error { /* ... */ }
class BridgeError<C extends BridgeErrorCode> extends Error { /* ... */ }
class MigrationError<C extends MigrationErrorCode> extends Error { /* ... */ }
class AssetServiceError<C extends AssetServiceErrorCode> extends Error { /* ... */ }
class ConcentratedLiquidityError<C extends ConcentratedLiquidityErrorCode> extends Error { /* ... */ }
// ...
```

In v2, all are consolidated:

```ts
// @ai-snippets-skip — type-shape reference; the real class is exported from @sodax/sdk
// v2
class SodaxError<C extends SodaxErrorCode = SodaxErrorCode> extends Error {
  readonly code: C;                  // closed reason union (no feature prefix)
  readonly feature: SodaxFeature;    // 'swap' | 'moneyMarket' | 'bridge' | …
  readonly cause?: unknown;
  readonly context?: SodaxErrorContext;
}
```

Discriminate via `(error.feature, error.code)` instead of class name.

## Error code crosswalk (key examples)

The SDK reduced the per-feature code unions to a unified 13-code reason vocabulary, with feature-specific context on `error.context.action` / `error.context.method`. Examples:

| v1 (per-feature) | v2 |
|---|---|
| `MoneyMarketError<'CREATE_SUPPLY_INTENT_FAILED'>` | `SodaxError<'INTENT_CREATION_FAILED'>` with `feature: 'moneyMarket'`, `context.action: 'supply'` |
| `MoneyMarketError<'SUPPLY_FAILED'>` | `SodaxError<'EXECUTION_FAILED'>` with `feature: 'moneyMarket'`, `context.action: 'supply'` |
| `IntentError<'CREATE_INTENT_FAILED'>` | `SodaxError<'INTENT_CREATION_FAILED'>` with `feature: 'swap'`, `context.action: 'createIntent'` |
| `IntentError<'POST_EXECUTION_FAILED'>` | `SodaxError<'EXECUTION_FAILED'>` with `feature: 'swap'`, `context.phase: 'postExecution'` |
| `StakingError<'STAKE_FAILED'>` | `SodaxError<'EXECUTION_FAILED'>` with `feature: 'staking'`, `context.action: 'stake'` |
| `BridgeError<'BRIDGE_FAILED'>` | `SodaxError<'EXECUTION_FAILED'>` with `feature: 'bridge'`, `context.action: 'bridge'` |
| `MigrationError<'MIGRATE_BNUSD_FORWARD_FAILED'>` | `SodaxError<'EXECUTION_FAILED'>` with `feature: 'migration'`, `context.action: 'migratebnUSD'`, `context.direction: 'forward'` |
| `*Error<'ALLOWANCE_CHECK_FAILED'>` | `SodaxError<'ALLOWANCE_CHECK_FAILED'>` (unchanged code; new feature/context fields) |
| `*Error<'APPROVE_FAILED'>` | Same |
| `*Error<'GAS_ESTIMATION_FAILED'>` | Same |
| `*Error<'RELAY_TIMEOUT'>` | `SodaxError<'RELAY_TIMEOUT'>` with `relayCode: 'RELAY_TIMEOUT'` on context |

Full crosswalk (per feature): [`../../../../sdk/ai-exported/migration/reference/error-code-crosswalk.md`](../../../../sdk/ai-exported/migration/reference/error-code-crosswalk.md).

## How to migrate error-handling code

### Pattern 1: `instanceof` checks → `isSodaxError`

```diff
- catch (e) {
-   if (e instanceof MoneyMarketError) {
-     handleMmError(e.code);
-   }
- }
+ catch (e) {
+   if (isSodaxError(e) && e.feature === 'moneyMarket') {
+     handleMmError(e.code);
+   }
+ }
```

`isSodaxError` is exported from `@sodax/dapp-kit` (re-exported from `@sodax/sdk`).

### Pattern 2: switch on code

```diff
  catch (e) {
-   if (e instanceof IntentError) {
-     switch (e.code) {
-       case 'CREATE_INTENT_FAILED': /* ... */ break;
-       case 'POST_EXECUTION_FAILED': /* ... */ break;
-       case 'RELAY_TIMEOUT': /* ... */ break;
-     }
-   }
+   if (isSodaxError(e) && e.feature === 'swap') {
+     switch (e.code) {
+       case 'INTENT_CREATION_FAILED': /* was CREATE_INTENT_FAILED */ break;
+       case 'EXECUTION_FAILED':       /* was POST_EXECUTION_FAILED — check e.context.phase */ break;
+       case 'RELAY_TIMEOUT':           /* unchanged code */ break;
+     }
+   }
  }
```

### Pattern 3: error-text helper

If your v1 code has a helper that maps `error.code` to a UI message, write a small adapter:

```ts
// adapters/v1ErrorShape.ts
import { isSodaxError } from '@sodax/dapp-kit';

const V1_CODE_MAP: Record<string, string> = {
  'INTENT_CREATION_FAILED': 'CREATE_INTENT_FAILED',
  'EXECUTION_FAILED': 'POST_EXECUTION_FAILED',
  // ... etc.
};

export function adaptToV1Code(error: unknown): string | undefined {
  if (!isSodaxError(error)) return undefined;
  return V1_CODE_MAP[error.code] ?? error.code;
}
```

Plan to delete the adapter once you've ported all error UI.

## Pitfalls

1. **`onError` callbacks fire MORE in v2.** They previously didn't fire for SDK `!ok` (success-path-with-error pattern). Now they do. Audit toasts / logs to make sure they're appropriate.
2. **`mutation.error` reads MORE in v2.** Same reason — SDK errors flow through it now.
3. **`isSodaxError(e)` is the cross-bundle-safe check.** Bare `instanceof SodaxError` may break in monorepos with multiple package copies (mixed ESM/CJS, etc.). Use the type guard.
4. **The `feature` field is your discriminator.** A `SodaxError` from a swap mutation has `feature: 'swap'`. A bridge mutation has `feature: 'bridge'`. The `code` is the reason; `feature` is the source.

## Cross-references

- [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md) — semantic shift in `Result<T>` handling.
- [`../breaking-changes/sdk-leakage.md`](../breaking-changes/sdk-leakage.md) — broader SDK-side migrations.
- [`../../../../sdk/ai-exported/migration/breaking-changes/result-and-errors.md`](../../../../sdk/ai-exported/migration/breaking-changes/result-and-errors.md) — full SDK error-class consolidation.
- [`../../../../sdk/ai-exported/migration/reference/error-code-crosswalk.md`](../../../../sdk/ai-exported/migration/reference/error-code-crosswalk.md) — per-feature error code crosswalks.
- [`../../integration/architecture.md`](../../integration/architecture.md) § "SDK Result handling" — design rationale.
