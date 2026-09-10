# PR #301 review response (comment 5618366934, commit 97f5f29)

Two consensus findings. Both verified valid against source.

## Finding 1 (Medium) — VALID
Direct `SwapsApi` singleton bypasses the demo's effective endpoint + API key; status polling
goes through the SDK client.

Verified:
- `lib/swapsApi.ts:11` → `VITE_SWAPS_API_BASE_URL ?? 'https://canary-api.sodax.com/v1'`, no `apiKey`,
  ignores the Sodax Settings modal entirely.
- `providers.tsx:136-143` → `swapsApiConfig` from `s.swapsApiBaseUrl ?? envSwapsApiBaseUrl ?? undefined`
  (= SDK packaged default) plus `apiKey: s.apiKey ?? envSodaxApiKey`.
- `@sodax/types` `DEFAULT_API_BASE_URL = 'https://api.sodax.com/v1'` (production).
  => shipped default: submit -> canary, poll -> production. Divergent.
- `pages/swaps-api/page.tsx` renders `OrderStatusPanel` -> `components/swaps/OrderStatus.tsx:386`
  polls via `useSwapsApiSubmitTxStatus` (SDK client). Reachable, as claimed.
- The docstring's "same host the demo's providers point `swapsApiConfig` at" is factually wrong.
- `apiKey` is deliberately NOT readable off `Sodax.instanceConfig` (Sodax.ts: held out of the merge),
  so the shared source must be the demo's own settings layer, not the SDK instance.
- True SDK precedence (`layerConfigs`) is swapsApiConfig -> baseApiConfig -> flat -> default, so the
  effective chain must also include `s.apiBaseUrl`.

Plan:
- [ ] Add `effectiveSwapsApiBaseUrl` / `effectiveSodaxApiKey` to `lib/sodaxSettings.ts` as the single
      precedence definition (`swapsApiBaseUrl ?? env ?? apiBaseUrl ?? DEFAULT_API_BASE_URL`).
- [ ] Consume them in `providers.tsx` (behavior-identical) so provider and page cannot drift.
- [ ] Replace the module-level singleton with a settings-reactive `useSwapsApiClient()` hook —
      settings are runtime-mutable via the modal, so a const captured at import time would go stale
      while the SDK provider re-memoizes.
- [ ] Include the base URL in the swaps-api query keys so switching endpoints can't serve cached
      responses from the previous deployment.
- [ ] Update both consumers (`SwapCard.tsx`, `swaps-api/OrderStatus.tsx`).

## Finding 2 (Medium) — VALID
`waitForTxFinality` awaits receipts without checking execution status, so my merge's `resetTx`
sequencing can proceed after a reverted reset.

Verified:
- `lib/signAndBroadcast.ts:175-190`: awaits `waitForTransactionReceipt` / `waitForConfirmation`,
  never reads EVM `receipt.status` or Stellar `successful`.
- `packages/dapp-kit/src/utils/approvalPlan.ts` `runApprovalPlan` does both checks and throws.
- `runApprovalPlan` IS public API (`utils/index.ts` -> `src/index.ts`).

Plan:
- [ ] Use `runApprovalPlan` from `@sodax/dapp-kit` for the approval broadcast instead of hand-rolling
      the sequence. Keeps `swapsApi.approve()` (raw wire client, the branch's intent) for the API call
      while the ordering + status checks stay owned by the package that already shares them across the
      swaps and bridge hooks.

## Out of scope (from the earlier review on 403eb62, not in this report)
- Missing `timeout` on the direct client. Report to the user rather than silently widening the diff.
- Unwired `swaps-api/OrderStatus.tsx`. Touched only as a consumer of the client change.

## Verification
- [ ] `pnpm checkTs`, `pnpm lint`, `pnpm test`, demo build

## Review (completed)

### Finding 1 — fixed
- `lib/sodaxSettings.ts`: added `effectiveSwapsApiBaseUrl` / `effectiveSodaxApiKey` as the single
  precedence definition (`swapsApiBaseUrl ?? VITE_SWAPS_API_BASE_URL ?? apiBaseUrl ?? DEFAULT_API_BASE_URL`,
  mirroring the SDK's `layerConfigs` order).
- `providers.tsx`: consumes both, so provider and page share one source. Resolved values are identical
  to the old inline chain in every case, verified against `layerConfigs`; the dynamic-config re-merge
  is disabled (`ConfigService` TODO config-v2) and layers `userConfig` on top anyway, so the explicit
  slice cannot lose to a backend value.
- `lib/swapsApi.ts`: the module singleton became `useSwapsApiClient()`, built from those resolvers and
  now passing `apiKey`. Reactive because the Sodax Settings modal changes both at runtime.
- Deliberately did NOT add an endpoint segment to the query keys: `providers.tsx` already builds a
  fresh QueryClient per `configKey` (the whole settings JSON) and remounts children, and the repo
  convention is documented as "query keys carry no env/endpoint segment".

### Finding 2 — fixed
- `handleApprove` hands the `{ tx, resetTx? }` plan to dapp-kit's `runApprovalPlan` (public API via
  `utils/index.ts`). That restores what the pre-merge hook path had: reset mined before approve, EVM
  `receipt.status` and Stellar `successful` inspected, and the chain sender resolved before any
  signature is requested. `swapsApi.approve()` stays the raw wire call, so the branch's intent holds.
- Removed the now-unused `waitForTxFinality` from `lib/signAndBroadcast.ts`. Keeping a
  receipt-arrival-equals-success helper would let the next caller reintroduce this exact bug; the
  header note now records that `runApprovalPlan` owns the step.
- No approve-path coverage lost: `runApprovalPlan` covers hub/EVM-spoke/Stellar, which is exactly
  `isApprovalSupportedChainKeyType` — every other chain reports allowance as sufficient, so Approve
  is disabled there. `handleSwap` still uses `signAndBroadcastSwapsApiTx` for all chains.

### Docs
- `apps/demo/AGENTS.md`: both stale claims corrected (the "canary `/v1` by default" client and the
  "`swapsApiConfig` only when overridden" pitfall), plus why the client must stay on the shared config.

### Verification
- [x] `pnpm checkTs` 13/13 · `pnpm lint` 13/13 · `biome check` clean on touched files
- [x] `pnpm test` 18/18 · `pnpm check:ai` 8/8 · `pnpm check:ai-dev-files` passed
- [x] `apps/demo` production build succeeds

### Reported, not acted on (from the earlier review of 403eb62, absent from this report)
- Direct client has no `timeout` (SDK path applies `DEFAULT_BACKEND_API_TIMEOUT`).
- `formatSwapsApiError` casts `error.context.body` without narrowing `message` to a string.
- `swaps-api/OrderStatus.tsx` still has no consumers.

## Follow-up: the two earlier-review items the user approved

### Timeout — fixed
`SwapsApiConfig.timeout` is documented "Omit for no timeout", so the client had no deadline at all
while the SDK path applies `DEFAULT_BACKEND_API_TIMEOUT` (30s) on every call. `useSwapsApiClient`
now passes that same constant, imported from `@sodax/dapp-kit` rather than restated as a literal.
Semantics match the SDK path: a whole-call ceiling including retries, failing as `TIMEOUT_ERROR`.

### Error-body narrowing — fixed
`context.body` is `unknown` by contract (parsed JSON if possible, else response text), so the
`as { message?: string }` cast was an unsafe escape hatch. A new `backendMessage` helper returns
`message` only when it is a non-blank string; every other shape falls through to
`formatMutationFailureMessage`, which also appends `cause`. Verified against 10 body shapes
(object/array/numeric/blank `message`, missing key, plain-text body, array, null, undefined) —
all fall through as intended.

### Verification
- [x] `pnpm checkTs` 13/13 · `pnpm lint` 13/13 · `pnpm test` 18/18 · `check:ai-dev-files` passed
- [x] `apps/demo` production build succeeds
- [x] `'message' in body` narrows without a cast, so no `any`/assertion was needed

### Left open by the user's call
- `swaps-api/OrderStatus.tsx` still has no consumers.
