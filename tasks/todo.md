# Merge origin/main (no-ff) into feat/original-swaps-api

## Context
- 75 commits from `origin/main` merged with `--no-ff`.
- Single conflict: `apps/demo/src/components/swaps-api/SwapCard.tsx` (6 hunks).
- Branch intent (`feat/original-swaps-api`): the demo's swaps-api page drives the raw
  `@sodax/swaps-api` wire client directly; dapp-kit stays only for wallet/signing and
  chain-prerequisite concerns.

## Conflict resolution decisions
- [ ] Imports: adopt main's `useStellarGate` (replaces `useStellarTrustlineCheck`/`useRequestTrustline`);
      do NOT re-add the `useSwapsApi*` data hooks (branch drives the raw client).
- [ ] Keep both `useQuery` (ours) and `@/lib/deliveryHooks` (main) imports.
- [ ] Keep ours for `swapsApi` + `waitForTxFinality` imports.
- [ ] Allowance: keep ours (direct `useQuery` + manual `refetchAllowance`); drop the three
      `useSwapsApi*` mutation hooks.
- [ ] `handleApprove`: keep the raw-client path AND handle the new `resetTx` from
      `ApproveResponseV2` — broadcast + confirm `resetTx` before `tx` (ordering main moved into
      `useSwapsApiApproveAndBroadcast` / `runApprovalPlan`).
- [ ] UI: keep both main's delivery-hook toggle and our `formatSwapsApiError` quote error.

## Verification
- [ ] `pnpm build:packages`
- [ ] `pnpm checkTs`
- [ ] `pnpm lint`
- [ ] commit + push to `feat/original-swaps-api`

## Review (completed)
All six hunks resolved by keeping the branch's raw-`@sodax/swaps-api` data path and adopting every
non-swaps-api improvement from `main`:

| Area | Resolution |
| --- | --- |
| dapp-kit imports | `useStellarGate` (main) in; `useSwapsApi*` data hooks stay out |
| Delivery hooks | main's `HOOK_LABELS` / `resolveAvailableHookKind` kept alongside our `useQuery` |
| `signAndBroadcast` imports | ours — `waitForTxFinality` is still needed client-side |
| Allowance | ours — direct `swapsApi.checkAllowance` query + manual `refetchAllowance` |
| `handleApprove` | ours, **extended**: `ApproveResponseV2` now carries an optional `resetTx`, so the reset is broadcast and confirmed before the approve (the ordering main moved into `runApprovalPlan`) |
| Quote error UI | both — main's hook toggle plus our `formatSwapsApiError` |

Auto-merged and verified as correct: `useBalances` (replaces `useXBalances`/`useXService`),
`PartnerFeeFields` + `partnerFee` on quote and intent, `SelectToken` moved to `components/shared/`,
EVM `expectedChainId` chain-binding in `signAndBroadcast.ts`, `isWrongChain` on the Approve button.

### Verification
- [x] `pnpm i` (lockfile merged cleanly)
- [x] `pnpm build:packages` — 7/7
- [x] `pnpm checkTs` — 13/13
- [x] `pnpm lint` — 13/13, `biome check src/components/swaps-api/` clean
- [x] `pnpm test` — 18/18 (2705 sdk tests)
- [x] `pnpm check:ai` — 8/8
- [x] `apps/demo` production build succeeds
