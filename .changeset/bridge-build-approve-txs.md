---
"@sodax/types": minor
"@sodax/sdk": minor
"@sodax/dapp-kit": minor
"@sodax/skills": minor
---

Extend the USDT stale-allowance fix to bridging. Unsigned bridge callers had no way to clear a stale
allowance: `sodax.bridge.approve({ raw: true })` returns a single transaction, and on an ERC-20 of the
2017 TetherToken lineage — Ethereum USDT is the one in the SODAX token list today — a wallet that
already holds a non-zero, insufficient allowance can only approve after an `approve(0)` that a single
transaction cannot express. Swaps got its way out in the previous release; bridge did not.

`sodax.bridge.buildApproveTxs` now returns `{ approveTx, resetTx? }` — named rather than ordered — and
`BridgeApproveResponseV2` gains an optional `resetTx` so the reset survives the backend `/bridge/approve`
route. `resetTx` appears only when the token needs one; broadcast it and wait for it to be mined before
`approveTx`, which is not valid until the reset has landed.

Spender resolution is shared with `approve` rather than duplicated, which matters because bridge does not
approve what swaps approves: on the hub it is the caller's own hub wallet router, resolved per user, not
the solver's intents contract. That keeps `buildApproveTxs` and `isAllowanceValid` pointing at the same
contract, so an allowance the SDK reports as insufficient is the allowance this grants.

Both approve-and-broadcast hooks now take an optional `onProgress` listener in their mutation vars.
It reports each transaction as `{ step, phase, index, total, hash?, error? }`, so a UI can say
"Clearing old allowance 1/2 — sign in your wallet" instead of one undifferentiated "Approving…"
across two signatures. Reporting is advisory: never awaited, and a listener that throws is ignored
rather than aborting a broadcast the user has already paid for.

dapp-kit adds `useBridgeApiApproveAndBroadcast`, the bridge counterpart of
`useSwapsApiApproveAndBroadcast`: it requests the plan, signs, broadcasts and waits for each
transaction, and invalidates `['bridgeApi','allowance']` once the approval has confirmed. A
transaction that mines but reverts rejects the mutation naming the step that failed, so the approve
is never sent over a reset that did not take. The ordering logic behind both hooks now lives in one
place (`utils/approvalPlan.ts`) rather than being re-derived per feature — the mistake the swaps
version was written to stop had already been made in two separate apps.

Both additions are additive. `approve` is unchanged and remains correct for signed execution, where
`SpokeService.approve` already runs the reset internally, and `useBridgeApiApprove` still returns the
raw transactions for callers that own their signing.
