# Recipe: Mutation error handling

Every dapp-kit mutation hook returns three ways to invoke the mutation. Pick by call shape — they all share the same React Query state under the hood (`isError`, `error`, `data`, devtools all work).

## The three call shapes

| Method | Returns | Rejects on `!ok`? | When to use |
|---|---|---|---|
| `mutate(vars)` | `void` (fire-and-forget) | Never | Button-click handlers where you read `isPending` / `isError` / `error` from the hook in render. |
| `mutateAsync(vars)` | `Promise<TData>` | **Yes** | Imperative chains where you only need the success value. **MUST be wrapped in `try/catch`** or you'll leak unhandled rejections on user-rejects. |
| `mutateAsyncSafe(vars)` | `Promise<Result<TData>>` | **Never** | Imperative chains where you want explicit branching without exception flow. |

`mutateAsyncSafe` is the **recommended default** for sequenced flows like `if (!hasAllowance) await approve(); await action();` — the user-reject case is the modal failure mode in dApps, not exceptional, and `Result<T>`-style branching reads cleaner than exception flow.

## fire-and-forget — `mutate`

Best for buttons that just kick off a mutation and let render reflect state.

```tsx
import { useSwap } from '@sodax/dapp-kit';

function SwapButton({ params, walletProvider }) {
  const m = useSwap();

  return (
    <>
      <button onClick={() => m.mutate({ params, walletProvider })} disabled={m.isPending}>
        {m.isPending ? 'Swapping...' : 'Swap'}
      </button>
      {m.isError && <p>Error: {m.error.message}</p>}
      {m.isSuccess && <p>Done!</p>}
    </>
  );
}
```

## throws — `mutateAsync`

Use when you want exception flow control. **Always wrap in `try/catch`.**

```tsx
import { useSwap } from '@sodax/dapp-kit';

function MyFlow({ params, walletProvider }) {
  const { mutateAsync: swap } = useSwap();

  const handleClick = async () => {
    try {
      const result = await swap({ params, walletProvider });
      navigate('/done');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Swap failed');
    }
  };
}
```

If you forget `try/catch`, an unhandled rejection lands in the global handler — most apps treat that as a fatal error.

## safe — `mutateAsyncSafe`

Recommended. Branches on `Result<T>`. Never rejects.

```tsx
// @ai-snippets-skip — Intent.intentHash placeholder
import { useSwap } from '@sodax/dapp-kit';

function MyFlow({ params, walletProvider }) {
  const { mutateAsyncSafe: swap } = useSwap();

  const handleClick = async () => {
    const result = await swap({ params, walletProvider });
    if (!result.ok) {
      toast.error(result.error instanceof Error ? result.error.message : 'Swap failed');
      return;
    }
    const { intent, intentDeliveryInfo } = result.value;
    navigate(`/done?intent=${intent.intentHash}`);
  };
}
```

Pairs well with sequenced flows:

```tsx
// @ai-snippets-skip — illustrative sequenced-flow pattern; `approve`, `swap`, `hasAllowance`
// are assumed from enclosing context (see recipes/swap.md for the full flow).
const handleSwap = async () => {
  if (!hasAllowance) {
    const a = await approve({ params, walletProvider });
    if (!a.ok) { toast.error('Approve failed'); return; }
  }
  const r = await swap({ params, walletProvider });
  if (!r.ok) { toast.error('Swap failed'); return; }
  // success
};
```

## Why `mutationFn` throws on SDK `!ok`

Inside the hook, `mutationFn` calls `unwrapResult` on the SDK's `Result<T>`:

- On `Result.ok === true` → returns the unwrapped `value` (TData).
- On `Result.ok === false` → throws `result.error`.

Why throw? Because React Query's error model (`isError`, `error`, `onError`, `retry`, `throwOnError`, devtools) keys off `mutationFn` throwing. With `Result<T>` returned as success, none of those engaged on SDK failure. Throwing makes them work out of the box.

The `mutateAsyncSafe` shim re-packs the throw back into a `Result<T>` so you can have it both ways: React Query's native error machinery in render + `Result<T>` ergonomics imperatively.

## Common pitfall — never call `useMutation` directly

Every dapp-kit mutation hook calls `useSafeMutation` (a thin wrapper). When you write your own wrapper hooks around dapp-kit mutations, do the same — call dapp-kit's hooks, not React Query's `useMutation`. Otherwise consumers won't get `mutateAsyncSafe`.

## Cross-references

- [`observability.md`](observability.md) — global `onMutationError` for logging/Sentry.
- [`invalidations.md`](invalidations.md) — composing your own `onSuccess` after dapp-kit's hook-owned invalidations.
- [`../architecture.md`](../architecture.md) — full design rationale for `useSafeMutation` / `unwrapResult`.
