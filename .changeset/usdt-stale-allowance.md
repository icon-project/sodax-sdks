---
"@sodax/types": minor
"@sodax/swaps-api": minor
"@sodax/sdk": minor
"@sodax/dapp-kit": minor
"@sodax/skills": minor
---

Unblock approvals on USDT-class tokens that hold a stale allowance. A few ERC-20s of the 2017
TetherToken lineage — Ethereum USDT is the one in the SODAX token list today — reject an allowance
change from one non-zero value to another, so a wallet that already has a non-zero, insufficient
allowance could never approve: every attempt reverted with empty data and the flow dead-ended with
no way forward.

`approve` now plans the approval first. When the token rejects the write, it sends `approve(0)`,
waits for it to be mined, then sends the real approval — the user signs twice. Detection is
behavioural (the SDK simulates the approve and reads the revert) rather than a token list, so a
token listed or upgraded later is covered without a code change, and the probes only run when an
allowance is already set, leaving the common path at one read. Signed callers need no change:
`approve` still resolves to a single transaction hash, the last one's, and every other token still
takes a single transaction. One behaviour worth surfacing in a UI — an approval may now prompt the
wallet twice.

For unsigned callers, `approve({ raw: true })` still returns exactly one transaction, which cannot
express a two-step plan. Two additions cover them: `sodax.swaps.buildApproveTxs` /
`sodax.spoke.buildApproveTxs` return `{ approveTx, resetTx? }` — named rather than ordered, so there
is no index to map — and `ApproveResponseV2` gains an optional `resetTx` to carry the reset over the
swaps API. dapp-kit adds `useSwapsApiApproveAndBroadcast`, which runs that whole sequence — request,
sign, broadcast, wait — so an integration does not have to re-derive the ordering; it also
invalidates `['swapsApi','allowance']` itself, which `useSwapsApiApprove` cannot. Both are additive — an existing raw
integration is unaffected until it opts in.
