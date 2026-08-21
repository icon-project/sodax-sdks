---
"@sodax/dapp-kit": patch
"@sodax/skills": patch
---

Stop `useStatus` from polling forever after a swap settles or the solver forgets the intent.

The hook still polls every 3s while the intent is in flight. It now stops on `SOLVED` (3) / `FAILED` (4), and after 40 consecutive successful fetches while status stays `NOT_FOUND` — a forgotten intent never changes. An in-flight status resets that streak, so a solver restart mid-fill cannot stop the query. Restore the old forever-poll with `queryOptions.refetchInterval: 3000`.
