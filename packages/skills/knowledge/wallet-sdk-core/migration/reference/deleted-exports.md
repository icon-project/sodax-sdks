# Deleted exports

**No symbols were deleted from the public surface between v1 and v2.** Every v1 named export is still available on v2's barrel.

If a v1 import does not compile against v2, the cause is most likely:

| Symptom | Likely cause |
|---|---|
| `Cannot find module '@sodax/wallet-sdk-core/wallet-providers/EvmWalletProvider'` | Deep import from v1's flat layout. Replace with barrel: `from '@sodax/wallet-sdk-core'`. See [`../breaking-changes/folder-layout.md`](../breaking-changes/folder-layout.md). |
| `'X' has no exported member 'Y'` against `@sodax/sdk` or `@sodax/types` | Not this package. See the corresponding package's migration docs. |
| Symbol `shallowMerge` not found | Internal in both v1 and v2 (v1 didn't even have it). Use `defaults` config + per-call options. |

---

## Internal symbols (never publicly exported, in any version)

| Symbol | Where it lives | Replacement |
|---|---|---|
| `shallowMerge` | `src/utils/merge.ts` (v2 only — did not exist in v1) | Use the `defaults` config + per-call options. Merge is automatic. |
| `serializeReceipt` | private static on `EvmWalletProvider` | `waitForTransactionReceipt` already returns the serialised shape. |
| Anything under `src/utils/` | — | Internal. |

If user code deep-imports one of these, it must be replaced with a public API call.

---

## How to verify

```bash
grep -rn "shallowMerge" <user-src>
# expect empty

grep -rn "@sodax/wallet-sdk-core/" <user-src> | grep -v "from '@sodax/wallet-sdk-core'"
# expect empty
```
