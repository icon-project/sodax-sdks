# Result<T> handling — v1 → v2

The most subtle breakage: `Result<T>` semantics inside dapp-kit's mutation pipeline inverted in v2.

## The semantic shift

| | v1 | v2 |
|---|---|---|
| `mutationFn` return | `Result<T>` | unwrapped `T`; throws on `!ok` |
| `mutation.data` shape | `Result<T>` (`{ ok, value }` or `{ ok, error }`) | unwrapped `T` (e.g. `SwapResponse`, `TxHashPair`) |
| Where to branch | Inside `onSuccess`: `if (data.ok) ...` | Branch on `mutation.error` / `mutation.isError`, OR use `mutateAsyncSafe` |
| `onSuccess` fires on SDK `!ok`? | **Yes** (success path) — required `data.ok` check inside | **No** — only on actual success |
| `onError` fires on SDK `!ok`? | No | **Yes** — engages React Query's native error model |
| `retry` config | Ignored on SDK `!ok` | Engages on SDK `!ok` |
| Devtools error display | Empty | Shows the SDK error |

The shift makes React Query's native error model engage for SDK failures, instead of treating every SDK call as "successful but maybe with an error inside."

## Why the change

In v1:
- Consumers had to remember to branch on `data.ok` inside every `onSuccess`. Forgetting was easy and silent (success logic ran on a failed swap).
- Hook-owned invalidations fired on SDK failure too, burning RPC traffic on every failed click.
- Devtools showed every mutation as "success" even when the SDK returned `{ ok: false }`.
- `retry` config didn't engage (the request didn't "fail" from React Query's perspective).

v2's `mutationFn` calls `unwrapResult(await sodax.<feature>.<method>(vars))`:
- `Result<T>` `{ ok: true; value }` → returns `value` (the unwrapped success type).
- `Result<T>` `{ ok: false; error }` → throws `error`.

This makes `isError`, `error`, `onError`, `retry`, devtools all work correctly out of the box.

## Migration patterns

### Pattern 1: success-path branching → drop the check

```diff
  const { mutateAsync: swap } = useSwap({
    mutationOptions: {
-     onSuccess: (data, vars) => {
-       if (data.ok) {
-         showSuccess(data.value.intent);
-       } else {
-         showError(data.error);
-       }
-     },
+     onSuccess: (data, vars) => {
+       // data is now SwapResponse — already-unwrapped success value.
+       showSuccess(data.intent);
+     },
+     onError: (error) => {
+       showError(error);
+     },
    },
  });
```

`onSuccess` only fires on actual success now; `onError` fires on SDK failure. Move the failure logic to `onError`.

### Pattern 2: imperative `mutateAsync` → wrap in try/catch

```diff
  const { mutateAsync: swap } = useSwap();
- const result = await swap({ params, spokeProvider });
- if (result.ok) {
-   navigate('/done');
- } else {
-   toast.error(result.error.message);
- }
+ try {
+   const result = await swap({ params, walletProvider });
+   navigate('/done');
+ } catch (e) {
+   toast.error(e instanceof Error ? e.message : 'Swap failed');
+ }
```

v2's `mutateAsync` rejects on SDK `!ok` — `try/catch` is mandatory. If you forget `try/catch`, an unhandled rejection lands in the global handler.

### Pattern 3: imperative `mutateAsync` → use `mutateAsyncSafe` (recommended)

If you prefer the v1 `Result<T>` ergonomics without exception flow, use `mutateAsyncSafe` — it never rejects:

```diff
- const { mutateAsync: swap } = useSwap();
- const result = await swap({ params, spokeProvider });
- if (result.ok) {
-   navigate('/done');
- } else {
-   toast.error(result.error.message);
- }
+ const { mutateAsyncSafe: swap } = useSwap();
+ const result = await swap({ params, walletProvider });
+ if (!result.ok) {
+   toast.error(result.error instanceof Error ? result.error.message : 'Swap failed');
+   return;
+ }
+ navigate('/done');
```

`mutateAsyncSafe` re-packs the throw inside `mutationFn` back into `Result<TData>`. Same React Query state under the hood (`isError`, `error`, devtools all work). Recommended for sequenced flows.

### Pattern 4: sequenced flow (approve + execute)

```diff
- // v1: branch on every step
- const result1 = await approve({ params, spokeProvider });
- if (!result1.ok) { toast(result1.error); return; }
- const result2 = await action({ params, spokeProvider });
- if (!result2.ok) { toast(result2.error); return; }
- navigate('/done');

+ // v2: same shape, but Result is from mutateAsyncSafe; walletProvider in mutate(vars)
+ const result1 = await approve({ params, walletProvider });
+ if (!result1.ok) { toast(result1.error.message); return; }
+ const result2 = await action({ params, walletProvider });
+ if (!result2.ok) { toast(result2.error.message); return; }
+ navigate('/done');
```

Just swap `mutateAsync` → `mutateAsyncSafe` and `spokeProvider` → `walletProvider`. The branching pattern stays nearly identical — same `result.ok` check.

## Edge case: `data` consumed in render

```diff
  function SwapResult() {
    const { data, isError } = useSwap();
-   if (data?.ok) return <p>Success: {data.value.intent.intentHash}</p>;
-   if (data && !data.ok) return <p>Error: {data.error.message}</p>;
+   const { data, error, isError } = useSwap();
+   if (data) return <p>Success: {data.intent.intentHash}</p>;
+   if (isError && error) return <p>Error: {error.message}</p>;
    return null;
  }
```

`data` is the unwrapped success value or `undefined`. `error` is the SDK error (or `null`). `isError` is the React Query flag.

## Edge case: `mutation.error` consumers

In v1, `mutation.error` only fired for actual exceptions (e.g. missing `walletProvider`, invalid input). In v2, it ALSO fires for SDK `!ok`. Audit all places that read `mutation.error` to ensure the new firings are appropriate.

```ts
// @ai-snippets-skip
// v1: error was rare (only thrown exceptions)
{mutation.error && <p>Unexpected error: {mutation.error.message}</p>}

// v2: error includes SDK !ok
// You may want to distinguish, e.g. check isSodaxError(error)
{mutation.error && (
  isSodaxError(mutation.error)
    ? <p>SDK error ({mutation.error.code}): {mutation.error.message}</p>
    : <p>Unexpected error: {mutation.error.message}</p>
)}
```

`isSodaxError` is exported from `@sodax/dapp-kit` (re-exported from `@sodax/sdk`).

## Edge case: query hooks returning `Result<T>` as data

A small set of query hooks for SDK methods that can fail in expected ways (e.g. quote unavailable, status not yet known) surface the `Result<T>` directly to the consumer as `data` rather than unwrapping. This is intentional — read failures are part of the data flow, not exception flow.

**Result-wrapped query hooks** (data is `Result<T> | undefined` — branch on `data?.ok`):

```tsx
// @ai-snippets-skip
// useQuote — SDK request goes under params.payload
const { data: quoteResult } = useQuote({ params: { payload: quotePayload } });
if (quoteResult?.ok) {
  const quote = quoteResult.value;
}

// useStatus — key is `intentTxHash`, NOT `intentHash`
const { data: statusResult } = useStatus({ params: { intentTxHash } });
if (statusResult?.ok) {
  const status = statusResult.value;
}
```

**Most other query hooks unwrap** the SDK Result inside the hook (`if (!result.ok) throw result.error`), so `data` is the success value directly and React Query's native error model (`isError`/`error`/`onError`/`retry`) engages on SDK failure. Examples:

```tsx
// @ai-snippets-skip
// useStakingInfo, useUnstakingInfo, useUnstakingInfoWithPenalty,
// useStakingConfig, useStakeRatio, useInstantUnstakeRatio, useConvertedAssets,
// all three staking allowance hooks (useStakeAllowance/useUnstakeAllowance/useInstantUnstakeAllowance),
// useMMAllowance, useSwapAllowance, useDexAllowance,
// all MM reserves + position hooks, all DEX read hooks except where noted —
// data is the unwrapped value. NO `.ok` / `.value` branching.
const { data: info, isError, error } = useStakingInfo({ params: { srcAddress, srcChainKey } });
// info is StakingInfo | undefined — read fields directly: info?.totalStaked
```

**`useBridgeAllowance` is special** — it returns `false` on SDK `!ok` (does NOT throw). The data is still `boolean | undefined`, just biased toward "not approved" on lookup error.

For per-hook truth, check the per-feature reference (`integration/features/<x>.md`).

## Done criteria for this category

- [ ] No `data.ok` checks inside mutation `onSuccess` callbacks.
- [ ] No `result.ok` branching after `mutateAsync(...)` (it now throws — either `try/catch` or use `mutateAsyncSafe`).
- [ ] All `mutateAsync` calls are wrapped in `try/catch` OR replaced with `mutateAsyncSafe`.
- [ ] `onError` callbacks audit — they now fire for SDK `!ok` (which they didn't before).
- [ ] Mutation `mutation.error` reads — same audit.

## Cross-references

- [`hook-signatures.md`](hook-signatures.md) — the structural changes (provider stack, hook shapes, approve returns).
- [`../../integration/recipes/mutation-error-handling.md`](../../integration/recipes/mutation-error-handling.md) — full v2 patterns for picking call shapes.
- [`../../integration/architecture.md`](../../integration/architecture.md) § "SDK Result handling" — full design rationale.
- [`../../../../sdk/ai-exported/migration/breaking-changes/result-and-errors.md`](../../../../sdk/ai-exported/migration/breaking-changes/result-and-errors.md) — SDK-side `Result<T>` migration (the underlying contract that dapp-kit translates).
